import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { addProjectFeedback } from "@/lib/agents/engine";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";

const schema = z.object({
  message: z.string().min(1).max(8000),
  afterStageId: z.string().uuid().optional(),
});

// Board feedback on a project (optionally anchored to a milestone) creates a
// formal branch milestone that addresses it and returns for review.
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

    const { stageId } = await addProjectFeedback(projectId, parsed.data.message, parsed.data.afterStageId ?? null);
    return Response.json({ ok: true, stageId }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
