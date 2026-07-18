import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { enqueueTask } from "@/lib/agents/engine";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agentTaskUpdates, agentTasks } from "@/lib/db/schema";

const schema = z.object({ message: z.string().min(1).max(8000) });

// Post follow-up feedback on a finished task. The feedback is recorded and
// the coordinator agent re-engages with the full task history and its
// company-action tools.
export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string; taskId: string }> }) {
  try {
    const { orgSlug, taskId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

    const task = await db.query.agentTasks.findFirst({
      where: and(eq(agentTasks.id, taskId), eq(agentTasks.organizationId, ctx.org.id), isNull(agentTasks.parentTaskId)),
    });
    if (!task) return Response.json({ error: "Task not found" }, { status: 404 });
    if (task.status === "pending" || task.status === "in_progress") {
      return Response.json({ error: "The task is still running — wait for it to finish first" }, { status: 409 });
    }

    await db.insert(agentTaskUpdates).values({
      taskId: task.id,
      kind: "feedback",
      content: parsed.data.message,
      authorUserId: ctx.user.id,
    });
    await db.update(agentTasks).set({ status: "in_progress", updatedAt: new Date() }).where(eq(agentTasks.id, task.id));

    enqueueTask(task.id, "continue");
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
