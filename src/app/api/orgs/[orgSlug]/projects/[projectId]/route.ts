import { and, asc, eq } from "drizzle-orm";

import { serializeTaskTree } from "@/lib/agents/serialize";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agents, projectStages, projects } from "@/lib/db/schema";

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");

    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), eq(projects.organizationId, ctx.org.id)),
    });
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    const manager = project.managerAgentId
      ? await db.query.agents.findFirst({ where: eq(agents.id, project.managerAgentId) })
      : null;

    const [tasks, stageRows] = await Promise.all([
      serializeTaskTree({ organizationId: ctx.org.id, projectId }),
      db.query.projectStages.findMany({
        where: eq(projectStages.projectId, projectId),
        orderBy: asc(projectStages.orderIndex),
      }),
    ]);

    // Group tasks under their milestone; tasks with no stage (legacy) fall into
    // a separate bucket the UI renders as "Other tasks".
    const stages = stageRows.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      gate: s.gate,
      status: s.status,
      summary: s.summary,
      reviewFeedback: s.reviewFeedback,
      orderIndex: s.orderIndex,
      isBranch: s.isBranch,
      tasks: tasks.filter((t) => t.stageId === s.id),
    }));
    const ungrouped = tasks.filter((t) => !t.stageId);

    return Response.json({
      project: {
        id: project.id,
        title: project.title,
        description: project.description,
        status: project.status,
        summary: project.summary,
        createdAt: project.createdAt,
        manager: manager
          ? { id: manager.id, name: manager.name, title: manager.title, avatarColor: manager.avatarColor }
          : null,
      },
      stages,
      ungrouped,
      tasks,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
