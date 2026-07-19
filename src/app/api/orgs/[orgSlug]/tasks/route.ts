import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createAndEnqueueTask } from "@/lib/agents/engine";
import { serializeTaskTree } from "@/lib/agents/serialize";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";

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

    const taskId = await createAndEnqueueTask({
      orgId: ctx.org.id,
      title,
      description,
      coordinatorAgentId,
      createdByUserId: ctx.user.id,
    });
    return Response.json({ task: { id: taskId } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    // Standalone tasks only (project tasks live under their project).
    const tasks = await serializeTaskTree({ organizationId: ctx.org.id, projectId: null });
    return Response.json({ tasks });
  } catch (err) {
    return errorResponse(err);
  }
}
