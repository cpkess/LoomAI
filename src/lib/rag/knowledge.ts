import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { collections, documents } from "@/lib/db/schema";
import { slugify } from "@/lib/utils";

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

/**
 * File a piece of text into the knowledge base as a markdown document and
 * kick off ingestion (chunk → embed → pgvector). Returns the document id.
 */
export async function addTextToKnowledge(options: {
  orgId: string;
  collectionId: string;
  title: string;
  content: string;
  userId?: string | null;
}): Promise<string> {
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
