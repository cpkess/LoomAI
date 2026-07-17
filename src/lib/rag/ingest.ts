import { eq } from "drizzle-orm";

import { listEnabledModels } from "@/lib/ai/registry";
import { db } from "@/lib/db";
import { collections, documentChunks, documents } from "@/lib/db/schema";

import { chunkText } from "./chunk";
import { embedTexts } from "./embed";
import { parseDocument } from "./parse";

// In-process ingestion queue. Uploads enqueue here and return immediately;
// documents move pending → processing → ready/error, which the knowledge UI
// polls. A dedicated worker/queue is a straightforward swap later since the
// pipeline is a single function of a document id.

const queue: { documentId: string; buffer: Buffer }[] = [];
let running = false;

export function enqueueDocument(documentId: string, buffer: Buffer): void {
  queue.push({ documentId, buffer });
  if (!running) void drain();
}

async function drain(): Promise<void> {
  running = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      try {
        await processDocument(job.documentId, job.buffer);
      } catch (err) {
        console.error(`ingestion failed for document ${job.documentId}`, err);
        await db
          .update(documents)
          .set({ status: "error", error: err instanceof Error ? err.message : String(err) })
          .where(eq(documents.id, job.documentId));
      }
    }
  } finally {
    running = false;
  }
}

async function processDocument(documentId: string, buffer: Buffer): Promise<void> {
  const document = await db.query.documents.findFirst({ where: eq(documents.id, documentId) });
  if (!document) return;

  await db.update(documents).set({ status: "processing", error: null }).where(eq(documents.id, documentId));

  const collection = await db.query.collections.findFirst({ where: eq(collections.id, document.collectionId) });
  if (!collection) throw new Error("Collection no longer exists");

  // Pin the collection to an embedding model on first ingest.
  let embeddingModelId = collection.embeddingModelId;
  if (!embeddingModelId) {
    const embeddingModels = await listEnabledModels("embedding");
    embeddingModelId = embeddingModels[0]?.id ?? null;
    if (!embeddingModelId) {
      throw new Error(
        "No embedding model available. Register a provider with an embedding model (e.g. an LM Studio embedding model), then retry."
      );
    }
    await db.update(collections).set({ embeddingModelId }).where(eq(collections.id, collection.id));
  }

  const text = await parseDocument(document.filename, buffer);
  if (!text.trim()) throw new Error("No text could be extracted from this file");

  const chunks = chunkText(text);
  const { vectors, dimensions } = await embedTexts(embeddingModelId, chunks);

  if (!collection.embeddingDimensions) {
    await db.update(collections).set({ embeddingDimensions: dimensions }).where(eq(collections.id, collection.id));
  }

  await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
  const BATCH = 100;
  for (let i = 0; i < chunks.length; i += BATCH) {
    await db.insert(documentChunks).values(
      chunks.slice(i, i + BATCH).map((content, offset) => ({
        documentId,
        collectionId: document.collectionId,
        chunkIndex: i + offset,
        content,
        embedding: vectors[i + offset],
        metadata: {},
      }))
    );
  }

  await db
    .update(documents)
    .set({ status: "ready", chunkCount: chunks.length, error: null })
    .where(eq(documents.id, documentId));
}
