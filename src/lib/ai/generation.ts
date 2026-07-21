// Generation defaults tuned for a capable mid-size local model — the ~27B
// class (e.g. Gemma 3 27B): strong instruction-following, reliable JSON, and
// good tool-calling, but still a local model where latency and drift matter.
//
// The philosophy:
//   - Keep temperature LOW where determinism and consistency matter (planning,
//     summaries, knowledge extraction) so the same input yields stable output.
//   - Allow more room (higher temperature, larger token budgets) for open-ended
//     work and chat, where a 27B model produces genuinely useful long-form.
//   - Lean on structured output and richer multi-step plans, which a model this
//     size handles reliably — smaller models could not.
//
// Every value can be overridden per-deployment via an env var, so operators
// running a smaller or larger model can retune without code changes.

function num(env: string, fallback: number): number {
  const raw = process.env[env];
  if (raw === undefined) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export interface GenSettings {
  temperature: number;
  maxOutputTokens?: number;
}

// Output-token budgets assume a ~32k-context local model (the default local
// setup LoomAI targets). With that much room the model can produce genuinely
// long-form work and comprehensive, sectioned summaries; a smaller context
// window should dial these down via the env overrides.

/** Per-call-type generation settings. */
export const generation = {
  /** Deterministic structured planning (delegation plans, project milestones). */
  plan: { temperature: num("LOOMAI_TEMP_PLAN", 0.3), maxOutputTokens: num("LOOMAI_MAXTOK_PLAN", 2000) },
  /** Open-ended execution — the actual work an employee delivers. */
  work: { temperature: num("LOOMAI_TEMP_WORK", 0.5), maxOutputTokens: num("LOOMAI_MAXTOK_WORK", 4000) },
  /** Summaries — stable, and roomy enough to be comprehensive. */
  summary: { temperature: num("LOOMAI_TEMP_SUMMARY", 0.3), maxOutputTokens: num("LOOMAI_MAXTOK_SUMMARY", 3000) },
  /** Knowledge extraction — factual, near-deterministic. */
  extract: { temperature: num("LOOMAI_TEMP_EXTRACT", 0.2), maxOutputTokens: num("LOOMAI_MAXTOK_EXTRACT", 2000) },
  /** Interactive chat — a bit more expressive. */
  chat: { temperature: num("LOOMAI_TEMP_CHAT", 0.6) } as GenSettings,
} satisfies Record<string, GenSettings>;

/**
 * Retrieval context budget. A 32k-context model can ground on a lot more
 * evidence, so we pull more chunks than a small-context model would tolerate.
 */
export const retrieval = {
  topK: Math.round(num("LOOMAI_RETRIEVAL_TOPK", 12)),
  minSimilarity: num("LOOMAI_RETRIEVAL_MIN_SIM", 0.2),
};

/**
 * Delegation and project shape limits. A capable model plans richer structures
 * reliably, so we allow deeper, longer projects (more milestones and tasks per
 * milestone) than the earlier tiny-model-safe defaults.
 */
export const limits = {
  maxSubtasks: Math.round(num("LOOMAI_MAX_SUBTASKS", 6)),
  maxStageTasks: Math.round(num("LOOMAI_MAX_STAGE_TASKS", 6)),
  maxMilestones: Math.round(num("LOOMAI_MAX_MILESTONES", 8)),
  /** Max tool-call round-trips within a single step. */
  toolSteps: Math.round(num("LOOMAI_TOOL_STEPS", 8)),
};
