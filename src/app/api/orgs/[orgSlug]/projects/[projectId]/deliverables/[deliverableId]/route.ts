import { and, asc, desc, eq } from "drizzle-orm";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { deliverableEvents, deliverableSections, deliverables } from "@/lib/db/schema";

// A deliverable's live production state: the outline (sections with status +
// content + issues) and the full event trail of the orchestrated workflow.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgSlug: string; projectId: string; deliverableId: string }> }
) {
  try {
    const { orgSlug, projectId, deliverableId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const d = await db.query.deliverables.findFirst({
      where: and(eq(deliverables.id, deliverableId), eq(deliverables.organizationId, ctx.org.id), eq(deliverables.projectId, projectId)),
    });
    if (!d) return Response.json({ error: "Deliverable not found" }, { status: 404 });

    const [sections, events] = await Promise.all([
      db.query.deliverableSections.findMany({
        where: eq(deliverableSections.deliverableId, deliverableId),
        orderBy: asc(deliverableSections.orderIndex),
      }),
      db.query.deliverableEvents.findMany({
        where: eq(deliverableEvents.deliverableId, deliverableId),
        orderBy: desc(deliverableEvents.createdAt),
        limit: 60,
      }),
    ]);

    return Response.json({
      deliverable: { id: d.id, title: d.title, kind: d.kind, brief: d.brief, status: d.status, iteration: d.iteration, content: d.content, error: d.error },
      sections: sections.map((s) => ({
        id: s.id,
        heading: s.heading,
        brief: s.brief,
        role: s.role,
        status: s.status,
        content: s.content,
        revision: s.revision,
        issues: s.evaluation,
      })),
      events: events.map((e) => ({ id: e.id, kind: e.kind, role: e.role, summary: e.summary, createdAt: e.createdAt })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
