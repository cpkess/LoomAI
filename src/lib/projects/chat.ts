import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { conversations, projects, type Organization, type Project } from "@/lib/db/schema";
import { orgDefaultModelId } from "@/lib/agents/subagent";

import { projectCollectionId } from "./knowledge";

// The project assistant: a per-project chat grounded in that project's own
// knowledge (its sources collection). Replaces the old department chat — there
// are no AI employees, just a helpful assistant that knows this project.

export interface ProjectChatConfig {
  modelDbId: string | null;
  system: string;
  /** Collections to ground retrieval on — the project's own sources. */
  collectionIds: string[];
}

function projectAssistantPersona(project: Pick<Project, "title" | "description">): string {
  return [
    `You are the project assistant for the project "${project.title}".`,
    project.description ? `Project goal: ${project.description}` : "",
    "Answer using the project's knowledge and cited sources. Be precise, cite where claims come from, and say clearly when the project's knowledge does not cover something. Do not invent facts.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Resolve model, system persona, and grounding collections for a project chat. */
export async function resolveProjectChatConfig(project: Project, org: Organization): Promise<ProjectChatConfig> {
  const collectionId = await projectCollectionId(project.id, org.id);
  return {
    modelDbId: await orgDefaultModelId(org),
    system: projectAssistantPersona(project),
    collectionIds: [collectionId],
  };
}

/** Load a project scoped to an org, or null. */
export async function ownedProject(orgId: string, projectId: string): Promise<Project | null> {
  return (
    (await db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), eq(projects.organizationId, orgId)),
    })) ?? null
  );
}

/** A user's conversations for a project, newest first. */
export async function projectConversations(projectId: string, userId: string) {
  return db.query.conversations.findMany({
    where: and(eq(conversations.projectId, projectId), eq(conversations.userId, userId)),
    orderBy: desc(conversations.updatedAt),
  });
}

/** Ordered messages of a conversation. */
export async function conversationMessages(conversationId: string) {
  const { messages } = await import("@/lib/db/schema");
  return db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: asc(messages.createdAt),
  });
}
