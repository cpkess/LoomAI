import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { errorResponse, requireOrg, roleAtLeast } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { collections, documents } from "@/lib/db/schema";
import { enqueueDocument } from "@/lib/rag/ingest";
import { slugify } from "@/lib/utils";

// Save a piece of employee-generated output into the knowledge base as a
// markdown document, either in an existing collection or a new one. The text
// runs through the same parse → chunk → embed ingestion pipeline as uploads.
const schema = z
  .object({
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(200_000),
    collectionId: z.string().uuid().optional(),
    newCollectionName: z.string().min(1).max(120).optional(),
  })
  .refine((d) => d.collectionId || d.newCollectionName, {
    message: "Choose a collection or provide a new collection name",
  });

export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const { title, content, collectionId, newCollectionName } = parsed.data;

    let targetCollectionId = collectionId;
    if (newCollectionName) {
      // Creating a collection requires manager rights.
      if (!roleAtLeast(ctx.role, "workspace_manager")) {
        return Response.json(
          { error: "You need workspace manager access to create a new collection" },
          { status: 403 }
        );
      }
      const [created] = await db
        .insert(collections)
        .values({ organizationId: ctx.org.id, name: newCollectionName })
        .returning();
      targetCollectionId = created.id;
    } else {
      const collection = await db.query.collections.findFirst({
        where: and(eq(collections.id, collectionId!), eq(collections.organizationId, ctx.org.id)),
      });
      if (!collection) return Response.json({ error: "Collection not found" }, { status: 404 });
    }

    const filename = `${slugify(title) || "note"}.md`;
    const body = `# ${title}\n\n${content}\n`;
    const buffer = Buffer.from(body, "utf8");

    const [document] = await db
      .insert(documents)
      .values({
        collectionId: targetCollectionId!,
        filename,
        mimeType: "text/markdown",
        sizeBytes: buffer.byteLength,
        status: "pending",
        uploadedByUserId: ctx.user.id,
      })
      .returning();

    enqueueDocument(document.id, buffer);
    return Response.json({ document, collectionId: targetCollectionId }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
