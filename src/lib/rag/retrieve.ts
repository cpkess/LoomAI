import { and, cosineDistance, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";

import { retrieval } from "@/lib/ai/generation";
import { db } from "@/lib/db";
import { collections, documentChunks, documents, type MessageSource } from "@/lib/db/schema";

import { embedTexts } from "./embed";

export interface RetrievedContext {
  sources: MessageSource[];
  /** Prompt block to append to the system prompt, or null when empty. */
  contextBlock: string | null;
}

const TOP_K = retrieval.topK;
const MIN_SIMILARITY = retrieval.minSimilarity;

/**
 * Retrieve the most relevant knowledge chunks for a query across the given
 * collections. Collections may use different embedding models, so the query
 * is embedded once per embedding model group and searched with pgvector
 * cosine similarity.
 */
export async function retrieveContext(collectionIds: string[], query: string): Promise<RetrievedContext> {
  const top = await retrieveScored(collectionIds, query, TOP_K);
  if (top.length === 0) return { sources: [], contextBlock: null };

  const sources: MessageSource[] = top.map((hit) => ({
    documentId: hit.documentId,
    filename: hit.filename,
    chunkIndex: hit.chunkIndex,
    snippet: hit.content.length > 200 ? `${hit.content.slice(0, 197)}…` : hit.content,
  }));

  const contextBlock = [
    "Relevant excerpts from the organization's knowledge base are provided below. Use them to answer when applicable and mention the source file when you rely on one.",
    ...top.map((hit, i) => `[Source ${i + 1}: ${hit.filename}]\n${hit.content}`),
  ].join("\n\n");

  return { sources, contextBlock };
}

/** A chunk hit with its relevance score and full (untruncated) content. */
export interface ScoredChunk {
  content: string;
  similarity: number;
  documentId: string;
  filename: string;
  chunkIndex: number;
}

/**
 * Reciprocal rank fusion. Vector and keyword search return scores on scales
 * that can't be compared (cosine vs. ts_rank), so fusing on rank rather than
 * score is the standard trick: each list contributes 1/(k+rank), and anything
 * both lists agree on rises to the top.
 *
 * `k` damps the influence of top positions; 60 is the usual default.
 */
export function reciprocalRankFusion<T>(lists: T[][], identity: (item: T) => string, k = 60): { item: T; score: number }[] {
  const scores = new Map<string, { item: T; score: number }>();
  for (const list of lists) {
    list.forEach((item, index) => {
      const id = identity(item);
      const existing = scores.get(id);
      const contribution = 1 / (k + index + 1);
      if (existing) existing.score += contribution;
      else scores.set(id, { item, score: contribution });
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}

/**
 * Keyword search over chunk text, using postgres full-text ranking. Vector
 * search alone misses exact terms — product names, figures, acronyms — which is
 * precisely what research questions turn on, so we run both and fuse.
 */
export async function retrieveKeyword(collectionIds: string[], query: string, k = TOP_K): Promise<ScoredChunk[]> {
  if (collectionIds.length === 0 || !query.trim()) return [];
  try {
    const tsquery = sql`websearch_to_tsquery('english', ${query})`;
    const rank = sql<number>`ts_rank(to_tsvector('english', ${documentChunks.content}), ${tsquery})`;
    const results = await db
      .select({
        content: documentChunks.content,
        documentId: documentChunks.documentId,
        chunkIndex: documentChunks.chunkIndex,
        similarity: rank,
      })
      .from(documentChunks)
      .where(and(inArray(documentChunks.collectionId, collectionIds), sql`to_tsvector('english', ${documentChunks.content}) @@ ${tsquery}`))
      .orderBy((t) => desc(t.similarity))
      .limit(k);
    if (results.length === 0) return [];

    const documentIds = [...new Set(results.map((h) => h.documentId))];
    const docs = await db.query.documents.findMany({ where: inArray(documents.id, documentIds) });
    const docsById = new Map(docs.map((d) => [d.id, d]));
    return results.map((hit) => ({ ...hit, filename: docsById.get(hit.documentId)?.filename ?? "unknown" }));
  } catch (err) {
    // Keyword search is an enhancement — never let it break retrieval.
    console.error("keyword retrieval failed", err);
    return [];
  }
}

/**
 * Hybrid retrieval: vector similarity fused with keyword ranking. Returns
 * chunks carrying their *vector* similarity where known, so downstream
 * relevance thresholds keep a consistent meaning; keyword-only hits get the
 * similarity they'd score on their own terms.
 */
export async function retrieveHybrid(collectionIds: string[], query: string, k = TOP_K): Promise<ScoredChunk[]> {
  const [vector, keyword] = await Promise.all([
    retrieveScored(collectionIds, query, k),
    retrieveKeyword(collectionIds, query, k),
  ]);
  if (keyword.length === 0) return vector;
  if (vector.length === 0) return keyword;

  const key = (c: ScoredChunk) => `${c.documentId}:${c.chunkIndex}`;
  const vectorSimilarity = new Map(vector.map((c) => [key(c), c.similarity]));
  return reciprocalRankFusion([vector, keyword], key)
    .slice(0, k)
    .map(({ item }) => ({ ...item, similarity: vectorSimilarity.get(key(item)) ?? item.similarity }));
}

/**
 * The scored retrieval primitive: the most relevant chunks for a query, with
 * their cosine similarity and full content intact. `retrieveContext` formats
 * these for a prompt; deep research ranks and cites them, so it needs the
 * scores and the untruncated text.
 */
export async function retrieveScored(collectionIds: string[], query: string, k = TOP_K): Promise<ScoredChunk[]> {
  if (collectionIds.length === 0 || !query.trim()) return [];

  const rows = await db.query.collections.findMany({ where: inArray(collections.id, collectionIds) });
  const groups = new Map<string, string[]>();
  for (const collection of rows) {
    if (!collection.embeddingModelId) continue; // nothing ingested yet
    const group = groups.get(collection.embeddingModelId) ?? [];
    group.push(collection.id);
    groups.set(collection.embeddingModelId, group);
  }
  if (groups.size === 0) return [];

  const hits: { content: string; similarity: number; documentId: string; chunkIndex: number }[] = [];

  for (const [embeddingModelId, groupCollectionIds] of groups) {
    let vector: number[];
    try {
      const batch = await embedTexts(embeddingModelId, [query]);
      vector = batch.vectors[0];
    } catch (err) {
      // Retrieval must never take down chat — skip collections whose
      // embedding model is unavailable.
      console.error(`query embedding failed for model ${embeddingModelId}`, err);
      continue;
    }

    const similarity = sql<number>`1 - (${cosineDistance(documentChunks.embedding, vector)})`;
    const results = await db
      .select({
        content: documentChunks.content,
        documentId: documentChunks.documentId,
        chunkIndex: documentChunks.chunkIndex,
        similarity,
      })
      .from(documentChunks)
      .where(
        and(
          inArray(documentChunks.collectionId, groupCollectionIds),
          isNotNull(documentChunks.embedding),
          gt(similarity, MIN_SIMILARITY)
        )
      )
      .orderBy((t) => desc(t.similarity))
      .limit(k);
    hits.push(...results);
  }

  if (hits.length === 0) return [];
  const top = hits.sort((a, b) => b.similarity - a.similarity).slice(0, k);

  const documentIds = [...new Set(top.map((h) => h.documentId))];
  const docs = await db.query.documents.findMany({ where: inArray(documents.id, documentIds) });
  const docsById = new Map(docs.map((d) => [d.id, d]));

  return top.map((hit) => ({ ...hit, filename: docsById.get(hit.documentId)?.filename ?? "unknown" }));
}
