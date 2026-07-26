import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { createLivingProject } from "@/lib/projects/create";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { deliverables, projectKnowledgeItems, projectSources, projects } from "@/lib/db/schema";

// A project is just a prompt space: type what you want, and the project is
// created from it. The title is derived from the prompt.
const createSchema = z.object({
  prompt: z.string().min(1).max(8000),
});

/** Derive a short title from the opening of a prompt. */
function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split("\n").find((l) => l.trim()) ?? prompt.trim();
  const clean = firstLine.replace(/\s+/g, " ").trim();
  if (clean.length <= 80) return clean;
  const cut = clean.slice(0, 80);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Enter a prompt" }, { status: 400 });

    const prompt = parsed.data.prompt.trim();
    const project = await createLivingProject({
      orgId: ctx.org.id,
      title: titleFromPrompt(prompt),
      description: prompt,
      createdByUserId: ctx.user.id,
      scope: false, // straight to a live project — the prompt is the brief
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
