import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { agents, type Agent } from "@/lib/db/schema";

import { getChiefAgent } from "./chief";

// Specialist workers for multi-stage deliverable production. Each role is a
// built-in persona the project manager can orchestrate, so deliverables work
// with zero setup. When the org has hired an AI employee whose title matches a
// role, we prefer that employee (its own model/persona) and still layer the
// role persona on top. Adding a new worker = adding a persona entry here.

export type Role =
  | "planner"
  | "researcher"
  | "writer"
  | "editor"
  | "proofreader"
  | "continuity"
  | "critic"
  | "gap_analysis";

export const ROLES: Role[] = [
  "planner",
  "researcher",
  "writer",
  "editor",
  "proofreader",
  "continuity",
  "critic",
  "gap_analysis",
];

interface RoleDef {
  label: string;
  persona: string;
  /** Title keywords that make a hired agent a good fit for this role. */
  match: string[];
}

export const ROLE_DEFS: Record<Role, RoleDef> = {
  planner: {
    label: "Planner",
    persona:
      "You are the Planner. You decompose a deliverable into a clear, non-overlapping outline of sections and subsections, each with a crisp brief describing exactly what it must cover. You think about logical flow, coverage of the goal, and the right level of granularity.",
    match: ["planner", "strategist", "architect", "lead"],
  },
  researcher: {
    label: "Researcher",
    persona:
      "You are the Researcher. You gather and synthesize the evidence a section needs from the project's knowledge and any tools you have, citing what supports each point and flagging where evidence is missing. You never invent facts.",
    match: ["research", "analyst", "analy"],
  },
  writer: {
    label: "Writer",
    persona:
      "You are the Writer. You produce clear, well-structured prose for a single section that fulfills its brief, grounded in the provided evidence and consistent with the rest of the document. Write only this section's content — no meta-commentary.",
    match: ["writer", "author", "copywriter", "content"],
  },
  editor: {
    label: "Editor",
    persona:
      "You are the Editor. You improve clarity, structure, tone, and concision, tighten weak transitions, and enforce consistent terminology, while preserving meaning and evidence.",
    match: ["editor", "editing"],
  },
  proofreader: {
    label: "Proofreader",
    persona:
      "You are the Proofreader. You catch grammar, spelling, punctuation, and formatting errors without changing substance.",
    match: ["proofread", "copy edit", "copyedit"],
  },
  continuity: {
    label: "Continuity reviewer",
    persona:
      "You are the Continuity reviewer. You check that sections fit together: consistent terminology and claims, no contradictions between sections, smooth transitions, and no unexplained repetition.",
    match: ["continuity", "consistency"],
  },
  critic: {
    label: "Critic",
    persona:
      "You are the Critic. You rigorously evaluate a section for logical consistency, unsupported claims, weak arguments, and deviations from the goal, and you list concrete, actionable issues. Be specific and honest, not agreeable.",
    match: ["critic", "review", "qa", "quality"],
  },
  gap_analysis: {
    label: "Gap analyst",
    persona:
      "You are the Gap analyst. You examine the whole outline against the goal to find missing topics, redundant or overlapping sections, and structural problems, and you propose concrete outline changes (add/merge/reorder).",
    match: ["gap", "audit", "reviewer"],
  },
};

/** Pure: does a hired agent's title/name fit a role? */
export function matchRole(titleOrName: string, role: Role): boolean {
  const hay = titleOrName.toLowerCase();
  return ROLE_DEFS[role].match.some((kw) => hay.includes(kw));
}

export interface ResolvedRole {
  role: Role;
  agent: Agent;
  /** The role persona, injected via agentReply's extraSystem. */
  persona: string;
  /** True when a hired employee (not the fallback manager) fills the role. */
  hired: boolean;
}

/**
 * Resolve who performs a role: a hired AI employee whose title matches, else
 * the given manager (or the org chief). The role persona is always applied.
 */
export async function resolveRoleAgent(orgId: string, role: Role, manager: Agent | null): Promise<ResolvedRole | null> {
  const active = await db.query.agents.findMany({
    where: and(eq(agents.organizationId, orgId), eq(agents.status, "active")),
    orderBy: (t, { asc }) => asc(t.createdAt),
  });
  const hiredMatch = active.find((a) => matchRole(`${a.title} ${a.name}`, role) && a.id !== manager?.id);
  const agent = hiredMatch ?? manager ?? (await getChiefAgent(orgId));
  if (!agent) return null;
  return { role, agent, persona: ROLE_DEFS[role].persona, hired: Boolean(hiredMatch) };
}
