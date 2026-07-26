import { db } from "@/lib/db";
import { projects, type Project } from "@/lib/db/schema";

import { projectCollectionId, recordProjectEvent } from "./knowledge";
import { addSource } from "./sources";

// Create a Living Project: an evolving workstream (not a milestone plan). It
// gets its own RAG collection, and any initial brief is filed as the first
// source so the knowledge graph starts building immediately. By default the
// project opens in the scoping loop ("planning"); pass scope:false to quick-
// create a project that's immediately live ("in_progress").
export async function createLivingProject(input: {
  orgId: string;
  title: string;
  description?: string | null;
  createdByUserId?: string | null;
  scope?: boolean;
}): Promise<Project> {
  const scope = input.scope !== false;
  const [project] = await db
    .insert(projects)
    .values({
      organizationId: input.orgId,
      title: input.title,
      description: input.description ?? null,
      status: scope ? "planning" : "in_progress",
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning();

  await projectCollectionId(project.id, input.orgId);
  await recordProjectEvent(project.id, "project_created", `Project "${input.title}" created`);

  if (input.description?.trim()) {
    await addSource({
      projectId: project.id,
      orgId: input.orgId,
      kind: "note",
      title: "Project brief",
      content: input.description.trim(),
      addedByUserId: input.createdByUserId ?? null,
    });
  }
  return project;
}
