import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { enqueueDeliverable } from "@/lib/agents/engine";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { deliverableSections, deliverables } from "@/lib/db/schema";
import type { SectionIssue } from "@/lib/projects/quality";

const schema = z.object({ feedback: z.string().max(2000).optional() });

// Human-in-the-loop: send one section back for revision (optionally with
// feedback), reopening the deliverable's production loop.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ orgSlug: string; projectId: string; deliverableId: string; sectionId: string }> }
) {
  try {
    const { orgSlug, projectId, deliverableId, sectionId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const d = await db.query.deliverables.findFirst({
      where: and(eq(deliverables.id, deliverableId), eq(deliverables.organizationId, ctx.org.id), eq(deliverables.projectId, projectId)),
    });
    if (!d) return Response.json({ error: "Deliverable not found" }, { status: 404 });
    const section = await db.query.deliverableSections.findFirst({
      where: and(eq(deliverableSections.id, sectionId), eq(deliverableSections.deliverableId, deliverableId)),
    });
    if (!section) return Response.json({ error: "Section not found" }, { status: 404 });
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    const feedback = parsed.success ? parsed.data.feedback : undefined;

    const issues = (section.evaluation as SectionIssue[]) ?? [];
    if (feedback?.trim()) issues.push({ kind: "human_feedback", detail: feedback.trim(), severity: "major" });

    await db.update(deliverableSections).set({ status: "revising", evaluation: issues }).where(eq(deliverableSections.id, sectionId));
    await db.update(deliverables).set({ status: "producing", updatedAt: new Date() }).where(eq(deliverables.id, deliverableId));
    enqueueDeliverable(deliverableId);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
