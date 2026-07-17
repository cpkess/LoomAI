import { and, eq } from "drizzle-orm";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { collections, documents } from "@/lib/db/schema";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ orgSlug: string; collectionId: string; documentId: string }> }
) {
  try {
    const { orgSlug, collectionId, documentId } = await params;
    const ctx = await requireOrg(orgSlug, "workspace_manager");
    const collection = await db.query.collections.findFirst({
      where: and(eq(collections.id, collectionId), eq(collections.organizationId, ctx.org.id)),
    });
    if (!collection) return Response.json({ error: "Collection not found" }, { status: 404 });
    const deleted = await db
      .delete(documents)
      .where(and(eq(documents.id, documentId), eq(documents.collectionId, collectionId)))
      .returning();
    if (deleted.length === 0) return Response.json({ error: "Document not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
