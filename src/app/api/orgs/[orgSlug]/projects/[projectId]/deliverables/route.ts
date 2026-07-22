import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getChiefAgent } from "@/lib/agents/chief";
import { enqueueDeliverable } from "@/lib/agents/engine";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { deliverables, projects } from "@/lib/db/schema";

const schema = z.object({
  title: z.string().min(1).max(200),
  kind: z.enum(["report", "strategy", "prd", "research_summary", "proposal", "memo"]).default("report"),
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
    if (!(await ownedProject(ctx.org.id, projectId))) return Response.json({ error: "Project not found" }, { status: 404 });
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

    const chief = await getChiefAgent(ctx.org.id);
    const [d] = await db
      .insert(deliverables)
      .values({
        projectId,
        organizationId: ctx.org.id,
        title: parsed.data.title,
        kind: parsed.data.kind,
        brief: parsed.data.brief ?? null,
        managerAgentId: chief?.id ?? null,
        qualityConfig: parsed.data.qualityConfig ?? {},
        createdByUserId: ctx.user.id,
      })
      .returning();
    enqueueDeliverable(d.id);
    return Response.json({ deliverable: { id: d.id } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
