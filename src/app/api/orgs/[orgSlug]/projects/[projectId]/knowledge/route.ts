import { and, desc, eq } from "drizzle-orm";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { projectEvents, projectKnowledgeEdges, projectKnowledgeItems, projects } from "@/lib/db/schema";

// The project's knowledge graph: typed items (with status), the relationships
// between them, and the recent event timeline.
export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), eq(projects.organizationId, ctx.org.id)),
    });
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    const [items, edges, events] = await Promise.all([
      db.query.projectKnowledgeItems.findMany({
        where: eq(projectKnowledgeItems.projectId, projectId),
        orderBy: desc(projectKnowledgeItems.updatedAt),
      }),
      db.query.projectKnowledgeEdges.findMany({ where: eq(projectKnowledgeEdges.projectId, projectId) }),
      db.query.projectEvents.findMany({
        where: eq(projectEvents.projectId, projectId),
        orderBy: desc(projectEvents.createdAt),
        limit: 40,
      }),
    ]);

    return Response.json({
      items: items.map((i) => ({
        id: i.id,
        type: i.type,
        content: i.content,
        status: i.status,
        confidence: i.confidence,
        reviewedAt: i.reviewedAt,
        updatedAt: i.updatedAt,
      })),
      edges: edges.map((e) => ({ id: e.id, from: e.fromItemId, to: e.toItemId, relation: e.relation, rationale: e.rationale })),
      events: events.map((e) => ({ id: e.id, kind: e.kind, summary: e.summary, createdAt: e.createdAt })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
