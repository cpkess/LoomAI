import { and, eq } from "drizzle-orm";

import { buildBriefing } from "@/lib/projects/briefing";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";

// The resume briefing — what changed, what's stale, open questions, risks, and
// recommended next steps. Marks the project viewed by this user.
export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), eq(projects.organizationId, ctx.org.id)),
    });
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    const briefing = await buildBriefing(projectId, ctx.user.id);
    return Response.json({ briefing });
  } catch (err) {
    return errorResponse(err);
  }
}
