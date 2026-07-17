import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { requireWorkspacePage } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agents, conversations, messages } from "@/lib/db/schema";

import { ChatView } from "./chat-view";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ orgSlug: string; workspaceSlug: string; conversationId: string }>;
}) {
  const { orgSlug, workspaceSlug, conversationId } = await params;
  const ctx = await requireWorkspacePage(orgSlug, workspaceSlug);

  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, conversationId),
      eq(conversations.workspaceId, ctx.workspace.id),
      eq(conversations.userId, ctx.user.id)
    ),
  });
  if (!conversation) notFound();

  const agent = conversation.agentId
    ? await db.query.agents.findFirst({ where: eq(agents.id, conversation.agentId) })
    : null;

  const history = await db.query.messages.findMany({
    where: eq(messages.conversationId, conversation.id),
    orderBy: asc(messages.createdAt),
  });

  return (
    <ChatView
      conversationId={conversation.id}
      title={conversation.title}
      agent={agent ? { name: agent.name, title: agent.title, avatarColor: agent.avatarColor } : null}
      initialMessages={history.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sources: m.sources ?? undefined,
      }))}
    />
  );
}
