import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { collectionWorkspaces, collections, workspaces } from "@/lib/db/schema";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullish(),
  workspaceIds: z.array(z.string().uuid()).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ orgSlug: string; collectionId: string }> }) {
  try {
    const { orgSlug, collectionId } = await params;
    const ctx = await requireOrg(orgSlug, "workspace_manager");
    const existing = await db.query.collections.findFirst({
      where: and(eq(collections.id, collectionId), eq(collections.organizationId, ctx.org.id)),
    });
    if (!existing) return Response.json({ error: "Collection not found" }, { status: 404 });

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });
    const data = parsed.data;

    if (data.name !== undefined || data.description !== undefined) {
      await db
        .update(collections)
        .set({
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
        })
        .where(eq(collections.id, collectionId));
    }

    if (data.workspaceIds !== undefined) {
      const rows = data.workspaceIds.length
        ? await db.query.workspaces.findMany({
            where: and(inArray(workspaces.id, data.workspaceIds), eq(workspaces.organizationId, ctx.org.id)),
          })
        : [];
      if (rows.length !== data.workspaceIds.length) {
        return Response.json({ error: "Unknown department" }, { status: 400 });
      }
      await db.delete(collectionWorkspaces).where(eq(collectionWorkspaces.collectionId, collectionId));
      if (data.workspaceIds.length > 0) {
        await db
          .insert(collectionWorkspaces)
          .values(data.workspaceIds.map((workspaceId) => ({ collectionId, workspaceId })));
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ orgSlug: string; collectionId: string }> }) {
  try {
    const { orgSlug, collectionId } = await params;
    const ctx = await requireOrg(orgSlug, "workspace_manager");
    const deleted = await db
      .delete(collections)
      .where(and(eq(collections.id, collectionId), eq(collections.organizationId, ctx.org.id)))
      .returning();
    if (deleted.length === 0) return Response.json({ error: "Collection not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
