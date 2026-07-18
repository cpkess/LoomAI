import { and, asc, eq } from "drizzle-orm";
import { stepCountIs, streamText, type UIMessage } from "ai";
import { z } from "zod";

import { resolveChatConfig } from "@/lib/agents/resolve";
import { resolveChatModel } from "@/lib/ai/registry";
import { buildAgentTools, describeAuthority, type AgentToolContext } from "@/lib/company/tools";
import { AuthorizationError, errorResponse, requireUser } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import {
  conversations,
  messages as messagesTable,
  organizations,
  workspaces,
  type MessageSource,
} from "@/lib/db/schema";
import { retrieveContext } from "@/lib/rag/retrieve";

export const maxDuration = 300;

const bodySchema = z.object({
  conversationId: z.string().uuid(),
  messages: z.array(z.unknown()),
});

function lastUserText(uiMessages: UIMessage[]): string {
  const last = [...uiMessages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  return last.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
    const { conversationId } = parsed.data;

    // The conversation must belong to the requesting user; workspace and org
    // are resolved from it server-side, never trusted from the client.
    const conversation = await db.query.conversations.findFirst({
      where: and(eq(conversations.id, conversationId), eq(conversations.userId, user.id)),
    });
    if (!conversation) throw new AuthorizationError("Conversation not found", 404);
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, conversation.workspaceId) });
    if (!workspace) throw new AuthorizationError("Workspace not found", 404);
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, workspace.organizationId) });
    if (!org) throw new AuthorizationError("Organization not found", 404);

    const userText = lastUserText(parsed.data.messages as UIMessage[]);
    if (!userText) return Response.json({ error: "Empty message" }, { status: 400 });

    const config = await resolveChatConfig(conversation, workspace, org);
    if (!config.modelDbId) {
      return Response.json(
        { error: "No AI model is available. Ask a platform administrator to register a provider and enable a chat model." },
        { status: 409 }
      );
    }
    const { model } = await resolveChatModel(config.modelDbId);

    await db.insert(messagesTable).values({ conversationId, role: "user", content: userText });
    if (conversation.title === "New conversation") {
      const title = userText.length > 64 ? `${userText.slice(0, 61)}…` : userText;
      await db.update(conversations).set({ title }).where(eq(conversations.id, conversationId));
    }
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));

    // History from the DB (source of truth), excluding the just-saved user turn
    // which we append explicitly below.
    const history = await db.query.messages.findMany({
      where: eq(messagesTable.conversationId, conversationId),
      orderBy: asc(messagesTable.createdAt),
    });

    const retrieved = await retrieveContext(config.collectionIds, userText);
    const toolContext: AgentToolContext = { actions: [] };
    const tools = config.agent ? buildAgentTools(config.agent, org, toolContext) : {};
    const authority = config.agent ? describeAuthority(config.agent, org) : null;

    const system =
      [config.system, authority, retrieved.contextBlock].filter(Boolean).join("\n\n") || undefined;
    const sources: MessageSource[] = retrieved.sources;

    const modelMessages = history.map((m) => ({ role: m.role, content: m.content }));

    const result = streamText({
      model,
      system,
      messages: modelMessages,
      ...(Object.keys(tools).length > 0 ? { tools, stopWhen: stepCountIs(6) } : {}),
      onFinish: async ({ text, usage }) => {
        await db.insert(messagesTable).values({
          conversationId,
          role: "assistant",
          content: text,
          sources: sources.length > 0 ? sources : null,
          actions: toolContext.actions.length > 0 ? toolContext.actions : null,
          inputTokens: usage.inputTokens ?? null,
          outputTokens: usage.outputTokens ?? null,
        });
      },
    });

    return result.toUIMessageStreamResponse({
      messageMetadata: ({ part }) => {
        if (part.type === "finish" && (sources.length > 0 || toolContext.actions.length > 0)) {
          return {
            ...(sources.length > 0 ? { sources } : {}),
            ...(toolContext.actions.length > 0 ? { actions: toolContext.actions } : {}),
          };
        }
        return undefined;
      },
      onError: (error) => {
        console.error("chat stream error", error);
        const message = error instanceof Error ? error.message : String(error);
        return `The model request failed: ${message}`;
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
