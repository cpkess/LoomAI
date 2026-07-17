import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { enqueueTask } from "@/lib/agents/engine";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agentTaskAssignments, agentTasks, agents } from "@/lib/db/schema";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(8000).optional(),
  coordinatorAgentId: z.string().uuid(),
});

export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });
    const { title, description, coordinatorAgentId } = parsed.data;

    const coordinator = await db.query.agents.findFirst({
      where: and(eq(agents.id, coordinatorAgentId), eq(agents.organizationId, ctx.org.id)),
    });
    if (!coordinator) return Response.json({ error: "Agent not found" }, { status: 404 });
    if (coordinator.status !== "active") {
      return Response.json({ error: `${coordinator.name} is paused` }, { status: 400 });
    }

    const [task] = await db
      .insert(agentTasks)
      .values({
        organizationId: ctx.org.id,
        title,
        description: description ?? null,
        status: "pending",
        createdByUserId: ctx.user.id,
      })
      .returning();
    await db.insert(agentTaskAssignments).values({ taskId: task.id, agentId: coordinator.id, role: "coordinator" });

    enqueueTask(task.id);
    return Response.json({ task }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "member");

    // Top-level tasks with their subtasks and assignments.
    const roots = await db.query.agentTasks.findMany({
      where: and(eq(agentTasks.organizationId, ctx.org.id), isNull(agentTasks.parentTaskId)),
      orderBy: desc(agentTasks.createdAt),
      limit: 50,
    });
    const rootIds = roots.map((t) => t.id);
    const children = rootIds.length
      ? await db.query.agentTasks.findMany({
          where: inArray(agentTasks.parentTaskId, rootIds),
          orderBy: (t, { asc }) => asc(t.createdAt),
        })
      : [];
    const allIds = [...rootIds, ...children.map((c) => c.id)];
    const assignments = allIds.length
      ? await db.query.agentTaskAssignments.findMany({ where: inArray(agentTaskAssignments.taskId, allIds) })
      : [];
    const agentIds = [...new Set(assignments.map((a) => a.agentId))];
    const taskAgents = agentIds.length
      ? await db.query.agents.findMany({ where: inArray(agents.id, agentIds) })
      : [];
    const agentsById = new Map(taskAgents.map((a) => [a.id, a]));

    const serialize = (task: typeof roots[number]) => {
      const assignment = assignments.find((a) => a.taskId === task.id);
      const agent = assignment ? agentsById.get(assignment.agentId) : undefined;
      return {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        result: task.result,
        error: task.error,
        createdAt: task.createdAt,
        agent: agent
          ? { id: agent.id, name: agent.name, title: agent.title, avatarColor: agent.avatarColor }
          : null,
      };
    };

    return Response.json({
      tasks: roots.map((root) => ({
        ...serialize(root),
        subtasks: children.filter((c) => c.parentTaskId === root.id).map(serialize),
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
