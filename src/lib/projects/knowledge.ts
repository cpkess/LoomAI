import { and, cosineDistance, desc, eq, ne, sql } from "drizzle-orm";

import { listEnabledModels } from "@/lib/ai/registry";
import { db } from "@/lib/db";
import {
  collections,
  projectEvents,
  projectKnowledgeEdges,
  projectKnowledgeEvidence,
  projectKnowledgeItems,
  type ProjectKnowledgeItem,
} from "@/lib/db/schema";
import { embedTexts } from "@/lib/rag/embed";
import { retrieveContext } from "@/lib/rag/retrieve";

// The project knowledge store: typed items connected by relationship edges and
// backed by evidence, with an event timeline. This is the persistent, evolving
// memory of a Living Project. Scoped similarity search (pgvector cosine) lets
// the analysis engine reconcile new information against what's already known.

export type ItemType = ProjectKnowledgeItem["type"];
export type ItemStatus = ProjectKnowledgeItem["status"];
export type Relation = "supports" | "contradicts" | "answers" | "refines" | "supersedes" | "raises";

/** Append to the project's evolving timeline. */
export async function recordProjectEvent(
  projectId: string,
  kind: string,
  summary: string,
  ref?: { type: string; id: string | null }
): Promise<void> {
  await db.insert(projectEvents).values({
    projectId,
    kind,
    summary,
    refType: ref?.type ?? null,
    refId: ref?.id ?? null,
  });
}

/** First enabled embedding model — the space project knowledge is embedded in. */
export async function defaultEmbeddingModelId(): Promise<string | null> {
  const models = await listEnabledModels("embedding");
  return models[0]?.id ?? null;
}

/** Embed one string; returns null when no embedding model is available. */
export async function embedOne(text: string): Promise<{ vector: number[]; modelId: string } | null> {
  const modelId = await defaultEmbeddingModelId();
  if (!modelId) return null;
  try {
    const { vectors } = await embedTexts(modelId, [text.slice(0, 4000)]);
    return { vector: vectors[0], modelId };
  } catch (err) {
    console.error("project knowledge embed failed", err);
    return null;
  }
}

export interface RelatedItem {
  item: ProjectKnowledgeItem;
  similarity: number;
}

/**
 * Nearest existing project knowledge items to a query vector, scoped to the
 * project and the embedding model the vector came from (cosine, HNSW-indexed).
 */
export async function findRelatedItems(
  projectId: string,
  vector: number[],
  modelId: string,
  k: number,
  excludeId?: string
): Promise<RelatedItem[]> {
  const similarity = sql<number>`1 - (${cosineDistance(projectKnowledgeItems.embedding, vector)})`;
  const rows = await db
    .select({ item: projectKnowledgeItems, similarity })
    .from(projectKnowledgeItems)
    .where(
      and(
        eq(projectKnowledgeItems.projectId, projectId),
        eq(projectKnowledgeItems.embeddingModelId, modelId),
        excludeId ? ne(projectKnowledgeItems.id, excludeId) : undefined
      )
    )
    .orderBy(desc(similarity))
    .limit(k);
  return rows.map((r) => ({ item: r.item, similarity: r.similarity }));
}

/** Insert a new knowledge item (embedded) with its first evidence + an event. */
export async function addItem(input: {
  projectId: string;
  orgId: string;
  type: ItemType;
  content: string;
  confidence?: number;
  embedding?: { vector: number[]; modelId: string } | null;
  evidence?: { sourceId: string | null; snippet: string };
}): Promise<ProjectKnowledgeItem> {
  const emb = input.embedding ?? (await embedOne(input.content));
  const [item] = await db
    .insert(projectKnowledgeItems)
    .values({
      projectId: input.projectId,
      organizationId: input.orgId,
      type: input.type,
      content: input.content,
      confidence: input.confidence ?? 0.6,
      embedding: emb?.vector ?? null,
      embeddingModelId: emb?.modelId ?? null,
    })
    .returning();
  if (input.evidence) {
    await db.insert(projectKnowledgeEvidence).values({
      itemId: item.id,
      sourceId: input.evidence.sourceId,
      snippet: input.evidence.snippet.slice(0, 1000),
    });
  }
  await recordProjectEvent(input.projectId, "item_added", `New ${input.type}: ${input.content.slice(0, 140)}`, {
    type: "item",
    id: item.id,
  });
  return item;
}

/** Reinforce an existing item with new corroborating evidence. */
export async function reinforceItem(
  item: ProjectKnowledgeItem,
  evidence: { sourceId: string | null; snippet: string }
): Promise<void> {
  await db.insert(projectKnowledgeEvidence).values({
    itemId: item.id,
    sourceId: evidence.sourceId,
    snippet: evidence.snippet.slice(0, 1000),
  });
  await db
    .update(projectKnowledgeItems)
    .set({
      confidence: Math.min(1, item.confidence + 0.15),
      reviewedAt: new Date(),
      updatedAt: new Date(),
      status: item.status === "stale" ? "active" : item.status,
    })
    .where(eq(projectKnowledgeItems.id, item.id));
  await recordProjectEvent(item.projectId, "item_updated", `Reinforced: ${item.content.slice(0, 140)}`, {
    type: "item",
    id: item.id,
  });
}

export async function setItemStatus(item: ProjectKnowledgeItem, status: ItemStatus, eventKind: string, summary: string): Promise<void> {
  await db
    .update(projectKnowledgeItems)
    .set({ status, updatedAt: new Date() })
    .where(eq(projectKnowledgeItems.id, item.id));
  await recordProjectEvent(item.projectId, eventKind, summary, { type: "item", id: item.id });
}

export async function addEdge(
  projectId: string,
  fromItemId: string,
  toItemId: string,
  relation: Relation,
  rationale?: string
): Promise<void> {
  await db.insert(projectKnowledgeEdges).values({ projectId, fromItemId, toItemId, relation, rationale: rationale ?? null });
}

/** Get (or lazily create) the project's dedicated "sources" collection id. */
export async function projectCollectionId(projectId: string, orgId: string): Promise<string> {
  const existing = await db.query.collections.findFirst({ where: eq(collections.projectId, projectId) });
  if (existing) return existing.id;
  const [created] = await db
    .insert(collections)
    .values({ organizationId: orgId, projectId, name: "Project sources", description: "Documents and notes for this project." })
    .returning();
  return created.id;
}

/**
 * Grounding text for producing deliverables: the most relevant knowledge items
 * plus retrieved excerpts from the project's own source collection.
 */
export async function retrieveProjectContext(
  project: { id: string; organizationId: string },
  query: string
): Promise<string> {
  const parts: string[] = [];

  const emb = await embedOne(query);
  if (emb) {
    const related = await findRelatedItems(project.id, emb.vector, emb.modelId, 12);
    const active = related.filter((r) => r.item.status !== "superseded");
    if (active.length > 0) {
      parts.push(
        ["What the project currently knows (most relevant):", ...active.map((r) => `- [${r.item.type}] ${r.item.content}`)].join(
          "\n"
        )
      );
    }
  }

  const collectionId = await projectCollectionId(project.id, project.organizationId);
  const retrieved = await retrieveContext([collectionId], query);
  if (retrieved.contextBlock) parts.push(retrieved.contextBlock);

  return parts.join("\n\n");
}
