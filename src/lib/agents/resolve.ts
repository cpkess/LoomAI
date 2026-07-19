import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  agents,
  prompts,
  type Agent,
  type Conversation,
  type Organization,
  type Workspace,
} from "@/lib/db/schema";
import { listEnabledModels } from "@/lib/ai/registry";
import { interpolatePrompt } from "@/lib/prompts/interpolate";
import { allOrgCollectionIds } from "@/lib/rag/knowledge";

export interface ChatConfig {
  /** ai_models row id to chat with. */
  modelDbId: string | null;
  /** Fully resolved system prompt (agent persona or selected prompt). */
  system?: string;
  /** Knowledge collections in scope for retrieval. */
  collectionIds: string[];
  agent?: Agent;
}

/**
 * Resolve everything a conversation needs to run: the model, the system
 * prompt, and the knowledge collections in scope.
 *
 * Agent conversations use the AI employee's own configuration (persona,
 * model, assigned collections) merged with the department's collections.
 * Plain conversations use the conversation's model/prompt selection with
 * the department's collections.
 */
export async function resolveChatConfig(
  conversation: Conversation,
  workspace: Workspace,
  org: Organization
): Promise<ChatConfig> {
  // Knowledge is org-wide: every conversation can draw on the whole company
  // knowledge base, no per-department or per-agent configuration required.
  const collectionIds = await allOrgCollectionIds(org.id);

  const workspaceSettings = (workspace.settings ?? {}) as { defaultModelId?: string };

  if (conversation.agentId) {
    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.id, conversation.agentId), eq(agents.organizationId, org.id)),
    });
    if (!agent) throw new Error("Agent not found");
    if (agent.status !== "active") throw new Error(`${agent.name} is currently paused`);

    const runtime = await resolveAgentRuntime(agent, org);

    return {
      modelDbId: runtime.modelDbId ?? workspaceSettings.defaultModelId ?? (await fallbackModelId()),
      system: runtime.system,
      collectionIds,
      agent,
    };
  }

  let system: string | undefined;
  if (conversation.systemPromptId) {
    const prompt = await db.query.prompts.findFirst({
      where: and(eq(prompts.id, conversation.systemPromptId), eq(prompts.organizationId, org.id)),
    });
    if (prompt) system = interpolatePrompt(prompt.content, { company: org.name });
  }

  return {
    modelDbId: conversation.modelId ?? workspaceSettings.defaultModelId ?? (await fallbackModelId()),
    system,
    collectionIds,
  };
}

export interface AgentRuntime {
  /** The agent's own model, or null when it should inherit a default. */
  modelDbId: string | null;
  /** Identity + persona system prompt. */
  system: string;
  /** Knowledge collections in scope — the whole org knowledge base. */
  collectionIds: string[];
}

/**
 * Resolve an AI employee's working configuration — identity/persona prompt,
 * model, and knowledge. Used by both chat and the delegation engine. Every
 * agent gets the entire organization knowledge base.
 */
export async function resolveAgentRuntime(agent: Agent, org: Organization): Promise<AgentRuntime> {
  let persona = agent.personaText ?? undefined;
  if (!persona && agent.personaPromptId) {
    const prompt = await db.query.prompts.findFirst({ where: eq(prompts.id, agent.personaPromptId) });
    if (prompt) {
      persona = interpolatePrompt(prompt.content, { name: agent.name, company: org.name });
    }
  }
  const identity = `You are ${agent.name}, ${org.name}'s "${agent.title}". You are an AI employee of ${org.name}.`;

  return {
    modelDbId: agent.modelId,
    system: persona ? `${identity}\n\n${persona}` : identity,
    collectionIds: await allOrgCollectionIds(org.id),
  };
}

/** First enabled chat model, so fresh installs work without per-workspace setup. */
export async function fallbackModelId(): Promise<string | null> {
  const models = await listEnabledModels("chat");
  return models[0]?.id ?? null;
}
