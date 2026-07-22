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

  // Make the raw text retrievable for deliverable production.
  if (input.content.trim()) {
    const collectionId = await projectCollectionId(input.projectId, input.orgId);
    await addTextToKnowledge({
      orgId: input.orgId,
      collectionId,
      title: input.title,
      content: input.content,
      userId: input.addedByUserId ?? null,
    }).catch((err) => console.error("project source ingest failed", err));
  }

  await recordProjectEvent(input.projectId, "source_added", `Added ${input.kind}: ${input.title}`, {
    type: "source",
    id: source.id,
  });
  enqueueSourceAnalysis(source.id);
  return source;
}
