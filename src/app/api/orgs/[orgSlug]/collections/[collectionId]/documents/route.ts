import { and, desc, eq } from "drizzle-orm";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { collections, documents } from "@/lib/db/schema";
import { enqueueDocument } from "@/lib/rag/ingest";
import { isSupportedFilename } from "@/lib/rag/parse";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string; collectionId: string }> }) {
  try {
    const { orgSlug, collectionId } = await params;
    const ctx = await requireOrg(orgSlug, "member");

    const collection = await db.query.collections.findFirst({
      where: and(eq(collections.id, collectionId), eq(collections.organizationId, ctx.org.id)),
    });
    if (!collection) return Response.json({ error: "Collection not found" }, { status: 404 });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "No file provided" }, { status: 400 });
    if (!isSupportedFilename(file.name)) {
      return Response.json(
        { error: "Unsupported file type. Supported: PDF, DOCX, Markdown, TXT, CSV, JSON, HTML." },
        { status: 400 }
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json({ error: "File exceeds the 25 MB upload limit" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const [document] = await db
      .insert(documents)
      .values({
        collectionId: collection.id,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        status: "pending",
        uploadedByUserId: ctx.user.id,
      })
      .returning();

    enqueueDocument(document.id, buffer);
    return Response.json({ document }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string; collectionId: string }> }) {
  try {
    const { orgSlug, collectionId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const collection = await db.query.collections.findFirst({
      where: and(eq(collections.id, collectionId), eq(collections.organizationId, ctx.org.id)),
    });
    if (!collection) return Response.json({ error: "Collection not found" }, { status: 404 });
    const rows = await db.query.documents.findMany({
      where: eq(documents.collectionId, collectionId),
      orderBy: desc(documents.createdAt),
    });
    return Response.json({ documents: rows });
  } catch (err) {
    return errorResponse(err);
  }
}
