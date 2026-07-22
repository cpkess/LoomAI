import { and, asc, desc, eq, or } from "drizzle-orm";
import { z } from "zod";

import { recordProjectEvent } from "@/lib/projects/knowledge";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import {
  projectEvents,
  projectKnowledgeEdges,
  projectKnowledgeEvidence,
  projectKnowledgeItems,
  projects,
} from "@/lib/db/schema";

async function loadItem(orgId: string, projectId: string, itemId: string) {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.organizationId, orgId)),
  });
  if (!project) return null;
  const item = await db.query.projectKnowledgeItems.findFirst({
    where: and(eq(projectKnowledgeItems.id, itemId), eq(projectKnowledgeItems.projectId, projectId)),
  });
  return item ?? null;
}

// Provenance / "how it evolved": the item plus its evidence, its relationships,
// and every event that ever referenced it.
export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string; itemId: string }> }) {
  try {
    const { orgSlug, projectId, itemId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const item = await loadItem(ctx.org.id, projectId, itemId);
    if (!item) return Response.json({ error: "Item not found" }, { status: 404 });

    const [evidence, edges, history] = await Promise.all([
      db.query.projectKnowledgeEvidence.findMany({
        where: eq(projectKnowledgeEvidence.itemId, itemId),
        orderBy: asc(projectKnowledgeEvidence.createdAt),
      }),
      db.query.projectKnowledgeEdges.findMany({
        where: or(eq(projectKnowledgeEdges.fromItemId, itemId), eq(projectKnowledgeEdges.toItemId, itemId)),
      }),
      db.query.projectEvents.findMany({
        where: and(eq(projectEvents.projectId, projectId), eq(projectEvents.refId, itemId)),
        orderBy: desc(projectEvents.createdAt),
      }),
    ]);

    return Response.json({
      item: { id: item.id, type: item.type, content: item.content, status: item.status, confidence: item.confidence, reviewedAt: item.reviewedAt },
      evidence: evidence.map((e) => ({ id: e.id, snippet: e.snippet, sourceId: e.sourceId, createdAt: e.createdAt })),
      edges: edges.map((e) => ({ id: e.id, from: e.fromItemId, to: e.toItemId, relation: e.relation, rationale: e.rationale })),
      history: history.map((e) => ({ id: e.id, kind: e.kind, summary: e.summary, createdAt: e.createdAt })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

const patchSchema = z.object({
  status: z.enum(["active", "challenged", "stale", "resolved", "superseded"]).optional(),
  content: z.string().min(1).max(2000).optional(),
  markReviewed: z.boolean().optional(),
});

// Human curation: resolve/challenge, confirm-as-reviewed (resets staleness), or edit.
export async function PATCH(req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string; itemId: string }> }) {
  try {
    const { orgSlug, projectId, itemId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const item = await loadItem(ctx.org.id, projectId, itemId);
    if (!item) return Response.json({ error: "Item not found" }, { status: 404 });
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

    await db
      .update(projectKnowledgeItems)
      .set({
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.content ? { content: parsed.data.content } : {}),
        ...(parsed.data.markReviewed ? { reviewedAt: new Date(), status: item.status === "stale" ? "active" : item.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(projectKnowledgeItems.id, itemId));
    await recordProjectEvent(projectId, "item_updated", `Curated by ${ctx.user.name}: ${item.content.slice(0, 100)}`, { type: "item", id: itemId });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
