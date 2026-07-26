import { and, eq } from "drizzle-orm";

import { reevaluateProject } from "@/lib/projects/analysis";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";

// Re-derive the project's recommended next steps from its current knowledge on
// demand (staleness is recomputed whenever the briefing is opened).
export async function POST(_req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), eq(projects.organizationId, ctx.org.id)),
    });
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
    await reevaluateProject(projectId);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
