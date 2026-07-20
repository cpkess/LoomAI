import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getChiefAgent } from "@/lib/agents/chief";
import { enqueueProject } from "@/lib/agents/engine";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agentTasks, agents, projectStages, projects } from "@/lib/db/schema";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(8000).optional(),
  managerAgentId: z.string().uuid().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

    // Default the project manager to the CEO (top of the AI org chart).
    let managerAgentId = parsed.data.managerAgentId;
    if (managerAgentId) {
      const manager = await db.query.agents.findFirst({
        where: and(eq(agents.id, managerAgentId), eq(agents.organizationId, ctx.org.id)),
      });
      if (!manager) return Response.json({ error: "Manager not found" }, { status: 404 });
    } else {
      managerAgentId = (await getChiefAgent(ctx.org.id))?.id;
    }
    if (!managerAgentId) {
      return Response.json({ error: "Hire an AI employee to manage projects first" }, { status: 400 });
    }

    const [project] = await db
      .insert(projects)
      .values({
        organizationId: ctx.org.id,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        status: "planning",
        managerAgentId,
        createdByUserId: ctx.user.id,
      })
      .returning();

    enqueueProject(project.id);
    return Response.json({ project }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "member");

    const rows = await db.query.projects.findMany({
      where: eq(projects.organizationId, ctx.org.id),
      orderBy: desc(projects.createdAt),
      limit: 50,
    });
    const projectIds = rows.map((p) => p.id);
    const [tasks, stages] = await Promise.all([
      projectIds.length
        ? db.query.agentTasks.findMany({ where: inArray(agentTasks.projectId, projectIds) })
        : Promise.resolve([]),
      projectIds.length
        ? db.query.projectStages.findMany({ where: inArray(projectStages.projectId, projectIds) })
        : Promise.resolve([]),
    ]);
    const managerIds = [...new Set(rows.flatMap((p) => (p.managerAgentId ? [p.managerAgentId] : [])))];
    const managers = managerIds.length
      ? await db.query.agents.findMany({ where: inArray(agents.id, managerIds) })
      : [];
    const managersById = new Map(managers.map((m) => [m.id, m]));

    return Response.json({
      projects: rows.map((p) => {
        const projTasks = tasks.filter((t) => t.projectId === p.id);
        const projStages = stages.filter((s) => s.projectId === p.id);
        const manager = p.managerAgentId ? managersById.get(p.managerAgentId) : undefined;
        return {
          id: p.id,
          title: p.title,
          description: p.description,
          status: p.status,
          summary: p.summary,
          createdAt: p.createdAt,
          manager: manager
            ? { id: manager.id, name: manager.name, title: manager.title, avatarColor: manager.avatarColor }
            : null,
          taskCount: projTasks.length,
          doneCount: projTasks.filter((t) => t.status === "completed" || t.status === "failed").length,
          stageCount: projStages.length,
          stageDoneCount: projStages.filter((s) => s.status === "completed" || s.status === "skipped").length,
          awaitingReview: projStages.some((s) => s.status === "awaiting_review"),
        };
      }),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
