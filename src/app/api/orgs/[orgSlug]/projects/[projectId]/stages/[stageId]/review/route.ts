import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { reviewStage } from "@/lib/agents/engine";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { projectStages, projects } from "@/lib/db/schema";

const schema = z.object({
  decision: z.enum(["approve", "request_changes"]),
  feedback: z.string().max(8000).optional(),
});

// The Board reviews a milestone waiting at a `review` gate: approve to advance
// the project, or request changes (the manager opens a revision task). Only
// organization admins (the Board) may decide.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ orgSlug: string; projectId: string; stageId: string }> }
) {
  try {
    const { orgSlug, projectId, stageId } = await params;
    const ctx = await requireOrg(orgSlug, "org_admin");
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

    // Ensure the stage belongs to a project in this org.
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), eq(projects.organizationId, ctx.org.id)),
    });
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
    const stage = await db.query.projectStages.findFirst({
      where: and(eq(projectStages.id, stageId), eq(projectStages.projectId, projectId)),
    });
    if (!stage) return Response.json({ error: "Milestone not found" }, { status: 404 });

    if (parsed.data.decision === "request_changes" && !parsed.data.feedback?.trim()) {
      return Response.json({ error: "Describe the changes you'd like" }, { status: 400 });
    }

    await reviewStage(stageId, parsed.data.decision, parsed.data.feedback?.trim() || null);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
