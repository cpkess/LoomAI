import { and, eq } from "drizzle-orm";

import { errorResponse, requireWorkspace } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ orgSlug: string; workspaceSlug: string; conversationId: string }> }
) {
  try {
    const { orgSlug, workspaceSlug, conversationId } = await params;
    const ctx = await requireWorkspace(orgSlug, workspaceSlug);
    const deleted = await db
      .delete(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.workspaceId, ctx.workspace.id),
          eq(conversations.userId, ctx.user.id)
        )
      )
      .returning();
    if (deleted.length === 0) return Response.json({ error: "Conversation not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
