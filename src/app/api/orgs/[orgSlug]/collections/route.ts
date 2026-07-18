import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { collectionWorkspaces, collections, workspaces } from "@/lib/db/schema";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  embeddingModelId: z.string().uuid().nullish(),
  workspaceIds: z.array(z.string().uuid()).default([]),
});

export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "workspace_manager");
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });
    const data = parsed.data;

    if (data.workspaceIds.length > 0) {
      const rows = await db.query.workspaces.findMany({
        where: and(inArray(workspaces.id, data.workspaceIds), eq(workspaces.organizationId, ctx.org.id)),
      });
      if (rows.length !== data.workspaceIds.length) {
        return Response.json({ error: "Unknown department" }, { status: 400 });
      }
    }

    const [collection] = await db
      .insert(collections)
      .values({
        organizationId: ctx.org.id,
        name: data.name,
        description: data.description ?? null,
        embeddingModelId: data.embeddingModelId ?? null,
      })
      .returning();

    if (data.workspaceIds.length > 0) {
      await db
        .insert(collectionWorkspaces)
        .values(data.workspaceIds.map((workspaceId) => ({ collectionId: collection.id, workspaceId })));
    }

    return Response.json({ collection }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const rows = await db.query.collections.findMany({
      where: eq(collections.organizationId, ctx.org.id),
      orderBy: (t, { asc }) => asc(t.name),
    });
    return Response.json({ collections: rows.map((c) => ({ id: c.id, name: c.name })) });
  } catch (err) {
    return errorResponse(err);
  }
}
