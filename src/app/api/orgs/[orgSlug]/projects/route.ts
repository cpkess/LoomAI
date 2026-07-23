import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { createLivingProject } from "@/lib/projects/create";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { deliverables, projectKnowledgeItems, projectSources, projects } from "@/lib/db/schema";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(8000).optional(),
  // Default true: open into the scoping loop. false = quick-create (live now).
  scope: z.boolean().optional(),
});

// Create a living project — an evolving workstream, not a milestone plan.
export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

    const project = await createLivingProject({
      orgId: ctx.org.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      createdByUserId: ctx.user.id,
      scope: parsed.data.scope,
    });
    return Response.json({ project: { id: project.id, status: project.status } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "member");

    const rows = await db.query.projects.findMany({
      where: eq(projects.organizationId, ctx.org.id),
      orderBy: desc(projects.updatedAt),
      limit: 50,
    });

    const [items, sources, dels] = await Promise.all([
      db.query.projectKnowledgeItems.findMany({
        where: eq(projectKnowledgeItems.organizationId, ctx.org.id),
        columns: { projectId: true, type: true, status: true },
      }),
      db.query.projectSources.findMany({
        where: eq(projectSources.organizationId, ctx.org.id),
        columns: { projectId: true },
      }),
      db.query.deliverables.findMany({
        where: eq(deliverables.organizationId, ctx.org.id),
        columns: { projectId: true, status: true },
      }),
    ]);

    return Response.json({
      projects: rows.map((p) => {
        const pItems = items.filter((i) => i.projectId === p.id);
        return {
          id: p.id,
          title: p.title,
          description: p.description,
          status: p.status,
          nextSteps: p.nextSteps,
          lastAnalyzedAt: p.lastAnalyzedAt,
          updatedAt: p.updatedAt,
          itemCount: pItems.length,
          openQuestions: pItems.filter((i) => i.type === "question" && i.status === "active").length,
          challenged: pItems.filter((i) => i.status === "challenged").length,
          stale: pItems.filter((i) => i.status === "stale").length,
          sourceCount: sources.filter((s) => s.projectId === p.id).length,
          deliverableCount: dels.filter((d) => d.projectId === p.id).length,
        };
      }),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
