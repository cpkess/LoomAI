import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { deliverables, projects } from "@/lib/db/schema";
import { createDeliverable } from "@/lib/projects/deliverables";
import { DELIVERABLE_KINDS } from "@/lib/projects/deliverableKinds";
import { parseCharter } from "@/lib/projects/scoping";

const schema = z.object({
  title: z.string().min(1).max(200),
  kind: z.enum(DELIVERABLE_KINDS).default("report"),
  brief: z.string().max(8000).optional(),
  qualityConfig: z
    .object({
      maxMajorIssues: z.number().int().min(0).max(10).optional(),
      requireNoBlocking: z.boolean().optional(),
      maxIterations: z.number().int().min(0).max(5).optional(),
    })
    .optional(),
});

async function ownedProject(orgId: string, projectId: string) {
  return db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.organizationId, orgId)) });
}

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    if (!(await ownedProject(ctx.org.id, projectId))) return Response.json({ error: "Project not found" }, { status: 404 });
    const rows = await db.query.deliverables.findMany({
      where: eq(deliverables.projectId, projectId),
      orderBy: desc(deliverables.createdAt),
    });
    return Response.json({
      deliverables: rows.map((d) => ({ id: d.id, title: d.title, kind: d.kind, status: d.status, iteration: d.iteration, createdAt: d.createdAt })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

// Kick off a multi-stage deliverable production run.
export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const project = await ownedProject(ctx.org.id, projectId);
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

    // With no brief, fall back to the project's objective so the deliverable is
    // still generated from the prompt + scope. The engine injects the full scope.
    const charter = parseCharter(project.charter);
    const brief = parsed.data.brief?.trim() || charter?.objective?.trim() || project.description?.trim() || null;

    const id = await createDeliverable({
      projectId,
      orgId: ctx.org.id,
      title: parsed.data.title,
      kind: parsed.data.kind,
      brief,
      qualityConfig: parsed.data.qualityConfig,
      createdByUserId: ctx.user.id,
    });
    return Response.json({ deliverable: { id } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
