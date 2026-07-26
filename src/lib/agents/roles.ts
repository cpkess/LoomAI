// Specialist subagents for multi-stage deliverable production. Each role is a
// built-in persona a project spins up on demand — no hiring, no org chart, zero
// setup. A subagent exists to do one bounded task (plan, research, write,
// critique, …) and is gone when its work is done. Adding a new specialist =
// adding a persona entry here.

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
}

export const ROLE_DEFS: Record<Role, RoleDef> = {
  planner: {
    label: "Planner",
    persona:
      "You are the Planner. You decompose a deliverable into a clear, non-overlapping outline of sections and subsections, each with a crisp brief describing exactly what it must cover. You think about logical flow, coverage of the goal, and the right level of granularity.",
  },
  researcher: {
    label: "Researcher",
    persona:
      "You are the Researcher. You gather and synthesize the evidence a section needs from the project's knowledge and any tools you have, citing what supports each point and flagging where evidence is missing. You never invent facts.",
  },
  writer: {
    label: "Writer",
    persona:
      "You are the Writer. You produce clear, well-structured prose for a single section that fulfills its brief, grounded in the provided evidence and consistent with the rest of the document. Write only this section's content — no meta-commentary.",
  },
  editor: {
    label: "Editor",
    persona:
      "You are the Editor. You improve clarity, structure, tone, and concision, tighten weak transitions, and enforce consistent terminology, while preserving meaning and evidence.",
  },
  proofreader: {
    label: "Proofreader",
    persona:
      "You are the Proofreader. You catch grammar, spelling, punctuation, and formatting errors without changing substance.",
  },
  continuity: {
    label: "Continuity reviewer",
    persona:
      "You are the Continuity reviewer. You check that sections fit together: consistent terminology and claims, no contradictions between sections, smooth transitions, and no unexplained repetition.",
  },
  critic: {
    label: "Critic",
    persona:
      "You are the Critic. You rigorously evaluate a section for logical consistency, unsupported claims, weak arguments, and deviations from the goal, and you list concrete, actionable issues. Be specific and honest, not agreeable.",
  },
  gap_analysis: {
    label: "Gap analyst",
    persona:
      "You are the Gap analyst. You examine the whole outline against the goal to find missing topics, redundant or overlapping sections, and structural problems, and you propose concrete outline changes (add/merge/reorder).",
  },
};

export interface RoleSubagent {
  role: Role;
  /** The role persona, passed to systemReply's `persona`. */
  persona: string;
}

/** The subagent that performs a role: just its built-in persona. */
export function subagentForRole(role: Role): RoleSubagent {
  return { role, persona: ROLE_DEFS[role].persona };
}
