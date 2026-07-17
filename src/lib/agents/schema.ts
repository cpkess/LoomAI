import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  agents,
  collections,
  organizationMembers,
  prompts,
  workspaces,
} from "@/lib/db/schema";

export const AVATAR_COLORS = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#8b5cf6", "#ef4444", "#84cc16"];

export const agentSchema = z.object({
  name: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  modelId: z.string().uuid().nullish(),
  personaPromptId: z.string().uuid().nullish(),
  personaText: z.string().max(8000).nullish(),
  reportsToAgentId: z.string().uuid().nullish(),
  reportsToUserId: z.string().uuid().nullish(),
  workspaceIds: z.array(z.string().uuid()).default([]),
  collectionIds: z.array(z.string().uuid()).default([]),
  avatarColor: z.string().max(20).nullish(),
});

export type AgentInput = z.infer<typeof agentSchema>;

/** Check every foreign reference in an agent payload belongs to the org. */
export async function validateAgentRelations(orgId: string, data: AgentInput): Promise<string | null> {
  if (data.reportsToAgentId && data.reportsToUserId) {
    return "An AI employee reports to a single manager — pick either a person or another agent";
  }
  if (data.reportsToAgentId) {
    const manager = await db.query.agents.findFirst({
      where: and(eq(agents.id, data.reportsToAgentId), eq(agents.organizationId, orgId)),
    });
    if (!manager) return "Manager agent not found";
  }
  if (data.reportsToUserId) {
    const member = await db.query.organizationMembers.findFirst({
      where: and(
        eq(organizationMembers.organizationId, orgId),
        eq(organizationMembers.userId, data.reportsToUserId)
      ),
    });
    if (!member) return "Manager is not a member of this organization";
  }
  if (data.personaPromptId) {
    const prompt = await db.query.prompts.findFirst({
      where: and(eq(prompts.id, data.personaPromptId), eq(prompts.organizationId, orgId)),
    });
    if (!prompt) return "Persona prompt not found";
  }
  if (data.workspaceIds.length > 0) {
    const rows = await db.query.workspaces.findMany({
      where: and(inArray(workspaces.id, data.workspaceIds), eq(workspaces.organizationId, orgId)),
    });
    if (rows.length !== data.workspaceIds.length) return "Unknown department";
  }
  if (data.collectionIds.length > 0) {
    const rows = await db.query.collections.findMany({
      where: and(inArray(collections.id, data.collectionIds), eq(collections.organizationId, orgId)),
    });
    if (rows.length !== data.collectionIds.length) return "Unknown collection";
  }
  return null;
}
