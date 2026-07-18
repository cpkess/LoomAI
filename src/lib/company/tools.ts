import { eq } from "drizzle-orm";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { db } from "@/lib/db";
import { agents, workspaces, type Agent, type MessageAction, type Organization } from "@/lib/db/schema";

import { ACTION_TYPES, COMPANY_ACTIONS, getGovernance, performAction, type ActionType } from "./actions";

export interface AgentToolContext {
  /** Company actions taken during the current turn (for persistence/UI). */
  actions: MessageAction[];
}

/**
 * Build the AI SDK tool set for an AI employee based on their granted
 * permissions. Includes a read-only company directory tool whenever any
 * action is granted, so agents can resolve names to ids before acting.
 */
export function buildAgentTools(agent: Agent, org: Organization, context: AgentToolContext): ToolSet {
  const granted = ACTION_TYPES.filter((type) => (agent.permissions ?? []).includes(type));
  if (granted.length === 0) return {};

  const governance = getGovernance(org);
  const tools: ToolSet = {};

  tools.list_company_directory = tool({
    description:
      "Look up the company directory: all AI employees (with ids, titles, managers, status) and all departments (with ids). Use this to find ids before taking personnel actions.",
    inputSchema: z.object({}),
    execute: async () => {
      const [orgAgents, departments] = await Promise.all([
        db.query.agents.findMany({ where: eq(agents.organizationId, org.id) }),
        db.query.workspaces.findMany({ where: eq(workspaces.organizationId, org.id) }),
      ]);
      return {
        employees: orgAgents.map((a) => ({
          id: a.id,
          name: a.name,
          title: a.title,
          status: a.status,
          reportsToAgentId: a.reportsToAgentId,
        })),
        departments: departments.map((d) => ({ id: d.id, name: d.name, description: d.description })),
      };
    },
  });

  for (const type of granted) {
    const definition = COMPANY_ACTIONS[type];
    const needsBoard = governance[type] === "board";
    tools[type] = tool({
      description:
        definition.description +
        (needsBoard
          ? " NOTE: this action requires Board approval — it will be queued and executed once a Board member approves."
          : " This action executes immediately."),
      inputSchema: definition.schema,
      execute: async (input: unknown) => {
        const outcome = await performAction(org, type as ActionType, input, { agentId: agent.id });
        context.actions.push({ type, status: outcome.status, summary: outcome.summary });
        return { status: outcome.status, detail: outcome.detail };
      },
    });
  }

  return tools;
}

/** Extra system-prompt block describing the agent's authority. */
export function describeAuthority(agent: Agent, org: Organization): string | null {
  const granted = ACTION_TYPES.filter((type) => (agent.permissions ?? []).includes(type));
  if (granted.length === 0) return null;
  const governance = getGovernance(org);
  const lines = granted.map((type) => {
    const definition = COMPANY_ACTIONS[type];
    return `- ${type}: ${definition.label} (${governance[type] === "board" ? "requires Board approval" : "autonomous"})`;
  });
  return [
    "You have real authority to manage company personnel through your tools:",
    ...lines,
    "Use list_company_directory to resolve employee/department names to ids before acting.",
    "When an action requires Board approval, submit it anyway when appropriate — it executes automatically after approval. Tell the user it is awaiting the Board.",
    "Act on clear requests without asking for unnecessary confirmation; day-to-day operations should not need Board involvement unless policy requires it.",
  ].join("\n");
}
