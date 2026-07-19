import { and, eq } from "drizzle-orm";

import { serializeTaskTree } from "@/lib/agents/serialize";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agents, projects } from "@/lib/db/schema";

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
    const tasks = await serializeTaskTree({ organizationId: ctx.org.id, projectId });

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
      tasks,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
