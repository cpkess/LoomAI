import { embedMany } from "ai";

import { resolveEmbeddingModel } from "@/lib/ai/registry";
import { EMBEDDING_DIMENSIONS } from "@/lib/db/schema";

/**
 * The document_chunks.embedding column is fixed at EMBEDDING_DIMENSIONS.
 * Model output is zero-padded up (cosine similarity is unaffected when both
 * sides are padded identically) or truncated down to fit. The model's true
 * dimension is recorded on the collection so retrieval embeds queries with
 * the same model and treatment.
 */
export function fitDimensions(vector: number[], target = EMBEDDING_DIMENSIONS): number[] {
  if (vector.length === target) return vector;
  if (vector.length > target) return vector.slice(0, target);
  return [...vector, ...new Array<number>(target - vector.length).fill(0)];
}

export interface EmbeddingBatch {
  vectors: number[][];
  dimensions: number;
}

export async function embedTexts(embeddingModelDbId: string, texts: string[]): Promise<EmbeddingBatch> {
  const { model } = await resolveEmbeddingModel(embeddingModelDbId);
  const { embeddings } = await embedMany({
    model,
    values: texts,
    maxParallelCalls: 2,
  });
  const dimensions = embeddings[0]?.length ?? 0;
  return { vectors: embeddings.map((e) => fitDimensions(e)), dimensions };
}
