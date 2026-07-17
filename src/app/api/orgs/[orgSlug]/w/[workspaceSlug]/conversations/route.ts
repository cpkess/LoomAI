import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { errorResponse, requireWorkspace } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agentWorkspaces, agents, conversations, prompts } from "@/lib/db/schema";

const createSchema = z.object({
  agentId: z.string().uuid().optional(),
  modelDbId: z.string().uuid().optional(),
  systemPromptId: z.string().uuid().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string; workspaceSlug: string }> }) {
  try {
    const { orgSlug, workspaceSlug } = await params;
    const ctx = await requireWorkspace(orgSlug, workspaceSlug);
    const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });
    const { agentId, modelDbId, systemPromptId } = parsed.data;

    if (agentId) {
      // The agent must be one of this org's AI employees, staffed in this department.
      const agent = await db.query.agents.findFirst({
        where: and(eq(agents.id, agentId), eq(agents.organizationId, ctx.org.id)),
      });
      if (!agent) return Response.json({ error: "Agent not found" }, { status: 404 });
      const assignment = await db.query.agentWorkspaces.findFirst({
        where: and(eq(agentWorkspaces.agentId, agentId), eq(agentWorkspaces.workspaceId, ctx.workspace.id)),
      });
      if (!assignment) {
        return Response.json({ error: `${agent.name} is not staffed in this department` }, { status: 400 });
      }
    }

    if (systemPromptId) {
      const prompt = await db.query.prompts.findFirst({
        where: and(eq(prompts.id, systemPromptId), eq(prompts.organizationId, ctx.org.id)),
      });
      if (!prompt) return Response.json({ error: "Prompt not found" }, { status: 404 });
    }

    const [conversation] = await db
      .insert(conversations)
      .values({
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        agentId: agentId ?? null,
        modelId: modelDbId ?? null,
        systemPromptId: systemPromptId ?? null,
      })
      .returning();
    return Response.json({ conversation }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string; workspaceSlug: string }> }) {
  try {
    const { orgSlug, workspaceSlug } = await params;
    const ctx = await requireWorkspace(orgSlug, workspaceSlug);
    const rows = await db.query.conversations.findMany({
      where: and(eq(conversations.workspaceId, ctx.workspace.id), eq(conversations.userId, ctx.user.id)),
      orderBy: desc(conversations.updatedAt),
      limit: 100,
    });
    return Response.json({ conversations: rows });
  } catch (err) {
    return errorResponse(err);
  }
}
