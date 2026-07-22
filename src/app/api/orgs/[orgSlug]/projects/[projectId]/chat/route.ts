import { and, asc, eq } from "drizzle-orm";
import { streamText, type UIMessage } from "ai";
import { z } from "zod";

import { asDetailedModelError } from "@/lib/ai/errors";
import { generation } from "@/lib/ai/generation";
import { resolveChatModel } from "@/lib/ai/registry";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { conversations, messages as messagesTable, type MessageSource } from "@/lib/db/schema";
import { ownedProject, resolveProjectChatConfig } from "@/lib/projects/chat";
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

export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const project = await ownedProject(ctx.org.id, projectId);
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
    const { conversationId } = parsed.data;

    const conversation = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.userId, ctx.user.id)
      ),
    });
    if (!conversation) return Response.json({ error: "Conversation not found" }, { status: 404 });

    const userText = lastUserText(parsed.data.messages as UIMessage[]);
    if (!userText) return Response.json({ error: "Empty message" }, { status: 400 });

    const config = await resolveProjectChatConfig(project, ctx.org);
    if (!config.modelDbId) {
      return Response.json(
        { error: "No AI model is available. Ask an admin to register a provider and enable a chat model." },
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

    const history = await db.query.messages.findMany({
      where: eq(messagesTable.conversationId, conversationId),
      orderBy: asc(messagesTable.createdAt),
    });

    const retrieved = await retrieveContext(config.collectionIds, userText);
    const system = [config.system, retrieved.contextBlock].filter(Boolean).join("\n\n") || undefined;
    const sources: MessageSource[] = retrieved.sources;

    const modelMessages = history.map((m) => ({ role: m.role, content: m.content }));

    const result = streamText({
      model,
      system,
      messages: modelMessages,
      temperature: generation.chat.temperature,
      onFinish: async ({ text, usage }) => {
        await db.insert(messagesTable).values({
          conversationId,
          role: "assistant",
          content: text,
          sources: sources.length > 0 ? sources : null,
          inputTokens: usage.inputTokens ?? null,
          outputTokens: usage.outputTokens ?? null,
        });
      },
    });

    return result.toUIMessageStreamResponse({
      messageMetadata: ({ part }) => {
        if (part.type === "finish" && sources.length > 0) return { sources };
        return undefined;
      },
      onError: (error) => {
        console.error("project chat stream error", error);
        return asDetailedModelError(error).message;
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
