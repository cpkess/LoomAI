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
