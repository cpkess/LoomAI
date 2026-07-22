import { and, eq } from "drizzle-orm";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");

    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), eq(projects.organizationId, ctx.org.id)),
    });
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    return Response.json({
      project: {
        id: project.id,
        title: project.title,
        description: project.description,
        status: project.status,
        nextSteps: project.nextSteps,
        lastAnalyzedAt: project.lastAnalyzedAt,
        createdAt: project.createdAt,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
