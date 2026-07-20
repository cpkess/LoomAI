import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getChiefAgent } from "@/lib/agents/chief";
import { createAndEnqueueTask, resolveManualTaskStage } from "@/lib/agents/engine";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agents, projects } from "@/lib/db/schema";

const schema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(8000).optional(),
  coordinatorAgentId: z.string().uuid().optional(),
});

// The project manager (or a Board member) adds a task within a project.
export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), eq(projects.organizationId, ctx.org.id)),
    });
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    // Default the task coordinator to the project manager, then the CEO.
    let coordinatorAgentId = parsed.data.coordinatorAgentId ?? project.managerAgentId ?? undefined;
    if (coordinatorAgentId) {
      const agent = await db.query.agents.findFirst({
        where: and(eq(agents.id, coordinatorAgentId), eq(agents.organizationId, ctx.org.id)),
      });
      if (!agent) return Response.json({ error: "Agent not found" }, { status: 404 });
      if (agent.status !== "active") return Response.json({ error: `${agent.name} is paused` }, { status: 400 });
    } else {
      coordinatorAgentId = (await getChiefAgent(ctx.org.id))?.id;
    }
    if (!coordinatorAgentId) return Response.json({ error: "No active AI employee to assign" }, { status: 400 });

    // Attach the task to a milestone so it flows through the stage/gate system
    // (this also reactivates a completed project with a follow-up milestone).
    const stageId = await resolveManualTaskStage(projectId);

    const taskId = await createAndEnqueueTask({
      orgId: ctx.org.id,
      projectId,
      stageId,
      title: parsed.data.title,
      description: parsed.data.description,
      coordinatorAgentId,
      createdByUserId: ctx.user.id,
    });

    // A new task means the project is active again (legacy stage-less projects).
    if (stageId === null && project.status === "completed") {
      await db.update(projects).set({ status: "in_progress", updatedAt: new Date() }).where(eq(projects.id, projectId));
    }
    return Response.json({ task: { id: taskId } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
