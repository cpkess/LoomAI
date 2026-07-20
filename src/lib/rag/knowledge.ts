import { and, cosineDistance, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { collections, documentChunks, documents } from "@/lib/db/schema";
import { slugify } from "@/lib/utils";

import { embedTexts } from "./embed";
import { enqueueDocument } from "./ingest";

// Shared knowledge-base helpers. Knowledge is org-wide: every AI employee can
// draw on the whole organization's knowledge without any per-agent or
// per-department configuration.

/** All collection ids for an organization — the full knowledge base. */
export async function allOrgCollectionIds(orgId: string): Promise<string[]> {
  const rows = await db.query.collections.findMany({
    where: eq(collections.organizationId, orgId),
    columns: { id: true },
  });
  return rows.map((r) => r.id);
}

const DEFAULT_COLLECTION_NAME = "Company Knowledge";

/**
 * Get (or create) the org's default collection, where auto-curated outputs
 * and quick notes are filed.
 */
export async function defaultKnowledgeCollectionId(orgId: string): Promise<string> {
  const existing = await db.query.collections.findFirst({
    where: and(eq(collections.organizationId, orgId), eq(collections.name, DEFAULT_COLLECTION_NAME)),
  });
  if (existing) return existing.id;
  const [created] = await db
    .insert(collections)
    .values({
      organizationId: orgId,
      name: DEFAULT_COLLECTION_NAME,
      description: "Knowledge captured automatically from the company's work, plus saved outputs.",
    })
    .returning();
  return created.id;
}

// Above this cosine similarity to an existing chunk, new knowledge is treated
// as already-known and skipped, so auto-capture keeps the base growing without
// filling it with near-duplicates. Programmatic — no LLM judgement needed.
const DEDUP_SIMILARITY = 0.94;

/**
 * Is this content already represented in the org's knowledge base? Embeds the
 * content once and checks the closest existing chunk (within collections that
 * share an embedding model). Returns false whenever nothing has been ingested
 * yet or the embedding model is unavailable — dedup must never block capture.
 */
export async function isDuplicateKnowledge(orgId: string, content: string): Promise<boolean> {
  const probe = content.trim().slice(0, 2000);
  if (!probe) return false;

  const orgCollections = await db.query.collections.findMany({
    where: eq(collections.organizationId, orgId),
    columns: { id: true, embeddingModelId: true },
  });
  const groups = new Map<string, string[]>();
  for (const c of orgCollections) {
    if (!c.embeddingModelId) continue;
    groups.set(c.embeddingModelId, [...(groups.get(c.embeddingModelId) ?? []), c.id]);
  }
  if (groups.size === 0) return false;

  for (const [embeddingModelId, collectionIds] of groups) {
    let vector: number[];
    try {
      vector = (await embedTexts(embeddingModelId, [probe])).vectors[0];
    } catch {
      continue; // model unavailable — don't block capture
    }
    const similarity = sql<number>`1 - (${cosineDistance(documentChunks.embedding, vector)})`;
    const [row] = await db
      .select({ similarity })
      .from(documentChunks)
      .where(and(inArray(documentChunks.collectionId, collectionIds), isNotNull(documentChunks.embedding)))
      .orderBy(desc(similarity))
      .limit(1);
    if (row && row.similarity >= DEDUP_SIMILARITY) return true;
  }
  return false;
}

/**
 * File a piece of text into the knowledge base as a markdown document and
 * kick off ingestion (chunk → embed → pgvector). Returns the new document id,
 * or null when `dedupe` is set and equivalent knowledge already exists.
 */
export async function addTextToKnowledge(options: {
  orgId: string;
  collectionId: string;
  title: string;
  content: string;
  userId?: string | null;
  /** Skip storing when near-identical knowledge already exists. */
  dedupe?: boolean;
}): Promise<string | null> {
  if (options.dedupe && (await isDuplicateKnowledge(options.orgId, options.content))) {
    return null;
  }

  const filename = `${slugify(options.title) || "note"}.md`;
  const body = `# ${options.title}\n\n${options.content}\n`;
  const buffer = Buffer.from(body, "utf8");

  const [document] = await db
    .insert(documents)
    .values({
      collectionId: options.collectionId,
      filename,
      mimeType: "text/markdown",
      sizeBytes: buffer.byteLength,
      status: "pending",
      uploadedByUserId: options.userId ?? null,
    })
    .returning();

  enqueueDocument(document.id, buffer);
  return document.id;
}
