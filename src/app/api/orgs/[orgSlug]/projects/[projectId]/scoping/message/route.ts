import { and, asc, eq } from "drizzle-orm";
import { streamText, type UIMessage } from "ai";
import { z } from "zod";

import { asDetailedModelError } from "@/lib/ai/errors";
import { generation } from "@/lib/ai/generation";
import { resolveChatModel } from "@/lib/ai/registry";
import { orgDefaultModelId } from "@/lib/agents/subagent";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { conversations, messages as messagesTable, organizations } from "@/lib/db/schema";
import { ownedProject } from "@/lib/projects/chat";
import { retrieveProjectContext } from "@/lib/projects/knowledge";
import { SCOPER_PERSONA, draftCharter, saveCharter } from "@/lib/projects/scoping";

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

// A turn of the scoping conversation: the scoper replies (streamed), then the
// work plan is re-drafted from the updated conversation and persisted so the
// plan panel stays current.
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
        eq(conversations.userId, ctx.user.id),
        eq(conversations.kind, "scoping")
      ),
    });
    if (!conversation) return Response.json({ error: "Scoping conversation not found" }, { status: 404 });

    const userText = lastUserText(parsed.data.messages as UIMessage[]);
    if (!userText) return Response.json({ error: "Empty message" }, { status: 400 });

    const modelDbId = await orgDefaultModelId(ctx.org);
    if (!modelDbId) {
      return Response.json({ error: "No AI model is available. Ask an admin to register a provider and enable a chat model." }, { status: 409 });
    }
    const { model } = await resolveChatModel(modelDbId);

    await db.insert(messagesTable).values({ conversationId, role: "user", content: userText });
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));

    const history = await db.query.messages.findMany({
      where: eq(messagesTable.conversationId, conversationId),
      orderBy: asc(messagesTable.createdAt),
    });

    const context = await retrieveProjectContext({ id: projectId, organizationId: ctx.org.id }, userText).catch(() => "");
    const system = [
      SCOPER_PERSONA,
      `You are scoping the project "${project.title}".`,
      project.description ? `Initial brief:\n${project.description}` : "",
      context ? `\nWhat the project already knows:\n${context}` : "",
      "Respond conversationally — refine the plan and ask at most a couple of focused questions. Do not output JSON here.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const modelMessages = history.map((m) => ({ role: m.role, content: m.content }));

    const result = streamText({
      model,
      system,
      messages: modelMessages,
      temperature: generation.chat.temperature,
      onFinish: async ({ text }) => {
        await db.insert(messagesTable).values({ conversationId, role: "assistant", content: text });
        // Re-draft the work plan from the updated conversation.
        try {
          const org = await db.query.organizations.findFirst({ where: eq(organizations.id, ctx.org.id) });
          const proj = await ownedProject(ctx.org.id, projectId);
          if (org && proj) {
            const charter = await draftCharter(proj, org, conversationId);
            await saveCharter(projectId, charter);
          }
        } catch (err) {
          console.error("scoping re-draft failed", err);
        }
      },
    });

    return result.toUIMessageStreamResponse({
      onError: (error) => {
        console.error("scoping stream error", error);
        return asDetailedModelError(error).message;
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
