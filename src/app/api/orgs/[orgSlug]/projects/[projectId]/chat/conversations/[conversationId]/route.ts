import { and, eq } from "drizzle-orm";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { conversationMessages, ownedProject } from "@/lib/projects/chat";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgSlug: string; projectId: string; conversationId: string }> }
) {
  try {
    const { orgSlug, projectId, conversationId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    if (!(await ownedProject(ctx.org.id, projectId))) return Response.json({ error: "Project not found" }, { status: 404 });

    const conversation = await db.query.conversations.findFirst({
      where: and(eq(conversations.id, conversationId), eq(conversations.projectId, projectId), eq(conversations.userId, ctx.user.id)),
    });
    if (!conversation) return Response.json({ error: "Conversation not found" }, { status: 404 });

    const rows = await conversationMessages(conversationId);
    return Response.json({
      conversation: { id: conversation.id, title: conversation.title },
      messages: rows.map((m) => ({ id: m.id, role: m.role, content: m.content, sources: m.sources ?? [] })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
