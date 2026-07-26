import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { projectSources, type ProjectSource } from "@/lib/db/schema";
import { addTextToKnowledge } from "@/lib/rag/knowledge";

import { enqueueSourceAnalysis } from "@/lib/agents/engine";
import { projectCollectionId, recordProjectEvent } from "./knowledge";

// Adding a source is the event that makes a project "living": the text is
// ingested into the project's RAG collection (so deliverables can retrieve it)
// and an analysis job is queued to fold it into the knowledge graph.

export async function addSource(input: {
  projectId: string;
  orgId: string;
  kind: ProjectSource["kind"];
  title: string;
  content: string;
  ref?: string | null;
  addedByUserId?: string | null;
  /** Skip the built-in text ingest (when the raw file is ingested separately). */
  skipIngest?: boolean;
}): Promise<ProjectSource> {
  const [source] = await db
    .insert(projectSources)
    .values({
      projectId: input.projectId,
      organizationId: input.orgId,
      kind: input.kind,
      title: input.title,
      content: input.content,
      ref: input.ref ?? null,
      addedByUserId: input.addedByUserId ?? null,
      status: "pending",
    })
    .returning();

  // Make the raw text retrievable for deliverable production. The document it
  // lands in is recorded on the source, so retrieval can trace a chunk back to
  // the source that produced it (and exclude it when it shouldn't be evidence).
  if (input.content.trim() && !input.skipIngest) {
    const collectionId = await projectCollectionId(input.projectId, input.orgId);
    const documentId = await addTextToKnowledge({
      orgId: input.orgId,
      collectionId,
      title: input.title,
      content: input.content,
      userId: input.addedByUserId ?? null,
    }).catch((err) => {
      console.error("project source ingest failed", err);
      return null;
    });
    if (documentId && !input.ref) {
      await db.update(projectSources).set({ ref: documentId }).where(eq(projectSources.id, source.id));
      source.ref = documentId;
    }
  }

  await recordProjectEvent(input.projectId, "source_added", `Added ${input.kind}: ${input.title}`, {
    type: "source",
    id: source.id,
  });
  enqueueSourceAnalysis(source.id);
  return source;
}
