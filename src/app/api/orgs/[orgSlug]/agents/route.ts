import { agentSchema, AVATAR_COLORS, validateAgentRelations } from "@/lib/agents/schema";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agentCollections, agentWorkspaces, agents } from "@/lib/db/schema";

export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "org_admin");
    const parsed = agentSchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const data = parsed.data;

    const problem = await validateAgentRelations(ctx.org.id, data);
    if (problem) return Response.json({ error: problem }, { status: 400 });

    const [agent] = await db
      .insert(agents)
      .values({
        organizationId: ctx.org.id,
        name: data.name,
        title: data.title,
        modelId: data.modelId ?? null,
        personaPromptId: data.personaPromptId ?? null,
        personaText: data.personaText || null,
        reportsToAgentId: data.reportsToAgentId ?? null,
        reportsToUserId: data.reportsToUserId ?? null,
        avatarColor: data.avatarColor ?? AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      })
      .returning();

    if (data.workspaceIds.length > 0) {
      await db
        .insert(agentWorkspaces)
        .values(data.workspaceIds.map((workspaceId) => ({ agentId: agent.id, workspaceId })));
    }
    if (data.collectionIds.length > 0) {
      await db
        .insert(agentCollections)
        .values(data.collectionIds.map((collectionId) => ({ agentId: agent.id, collectionId })));
    }

    return Response.json({ agent }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
