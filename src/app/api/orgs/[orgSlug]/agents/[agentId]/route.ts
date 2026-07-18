import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { agentSchema, validateAgentRelations } from "@/lib/agents/schema";
import { assertNoReportingCycle } from "@/lib/agents/validate";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agentCollections, agentWorkspaces, agents } from "@/lib/db/schema";

const updateSchema = agentSchema.partial().extend({
  status: z.enum(["active", "paused"]).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ orgSlug: string; agentId: string }> }) {
  try {
    const { orgSlug, agentId } = await params;
    const ctx = await requireOrg(orgSlug, "org_admin");

    const existing = await db.query.agents.findFirst({
      where: and(eq(agents.id, agentId), eq(agents.organizationId, ctx.org.id)),
    });
    if (!existing) return Response.json({ error: "Agent not found" }, { status: 404 });

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const data = parsed.data;

    const problem = await validateAgentRelations(ctx.org.id, {
      ...data,
      name: data.name ?? existing.name,
      title: data.title ?? existing.title,
      workspaceIds: data.workspaceIds ?? [],
      collectionIds: data.collectionIds ?? [],
      permissions: data.permissions ?? [],
    });
    if (problem) return Response.json({ error: problem }, { status: 400 });

    if (data.reportsToAgentId) {
      if (data.reportsToAgentId === agentId) {
        return Response.json({ error: "An AI employee cannot report to itself" }, { status: 400 });
      }
      try {
        await assertNoReportingCycle(agentId, data.reportsToAgentId);
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : "Invalid manager" }, { status: 400 });
      }
    }

    const [agent] = await db
      .update(agents)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.modelId !== undefined ? { modelId: data.modelId } : {}),
        ...(data.personaPromptId !== undefined ? { personaPromptId: data.personaPromptId } : {}),
        ...(data.personaText !== undefined ? { personaText: data.personaText || null } : {}),
        ...(data.reportsToAgentId !== undefined || data.reportsToUserId !== undefined
          ? { reportsToAgentId: data.reportsToAgentId ?? null, reportsToUserId: data.reportsToUserId ?? null }
          : {}),
        ...(data.avatarColor !== undefined ? { avatarColor: data.avatarColor } : {}),
        ...(data.permissions !== undefined ? { permissions: data.permissions } : {}),
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agentId))
      .returning();

    if (data.workspaceIds !== undefined) {
      await db.delete(agentWorkspaces).where(eq(agentWorkspaces.agentId, agentId));
      if (data.workspaceIds.length > 0) {
        await db
          .insert(agentWorkspaces)
          .values(data.workspaceIds.map((workspaceId) => ({ agentId, workspaceId })));
      }
    }
    if (data.collectionIds !== undefined) {
      await db.delete(agentCollections).where(eq(agentCollections.agentId, agentId));
      if (data.collectionIds.length > 0) {
        await db
          .insert(agentCollections)
          .values(data.collectionIds.map((collectionId) => ({ agentId, collectionId })));
      }
    }

    return Response.json({ agent });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ orgSlug: string; agentId: string }> }) {
  try {
    const { orgSlug, agentId } = await params;
    const ctx = await requireOrg(orgSlug, "org_admin");
    const deleted = await db
      .delete(agents)
      .where(and(eq(agents.id, agentId), eq(agents.organizationId, ctx.org.id)))
      .returning();
    if (deleted.length === 0) return Response.json({ error: "Agent not found" }, { status: 404 });
    // Clear dangling manager references from former reports
    await db
      .update(agents)
      .set({ reportsToAgentId: null })
      .where(eq(agents.reportsToAgentId, agentId));
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
