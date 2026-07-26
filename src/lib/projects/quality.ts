// Configurable quality gates for multi-stage deliverables. The review workers
// attach issues to each section; this pure evaluator decides whether the
// deliverable clears the bar, which sections need another revision pass, and
// when to stop (max iterations) so production always terminates.

export type IssueSeverity = "minor" | "major" | "blocking";

export interface SectionIssue {
  kind: string; // e.g. "unsupported_claim", "contradiction", "off_goal", "weak_transition"
  detail: string;
  severity: IssueSeverity;
}

export interface QualityConfig {
  /** A section fails if it has more than this many major/blocking issues. */
  maxMajorIssues: number;
  /** Any contradiction/blocking issue fails the gate outright. */
  requireNoBlocking: boolean;
  /** Hard cap on revision rounds so production always terminates. */
  maxIterations: number;
}

export const DEFAULT_QUALITY: QualityConfig = {
  maxMajorIssues: 0,
  requireNoBlocking: true,
  maxIterations: 2,
};

export function resolveQualityConfig(raw: unknown): QualityConfig {
  const c = (raw ?? {}) as Partial<QualityConfig>;
  return {
    maxMajorIssues: Number.isFinite(c.maxMajorIssues) ? Number(c.maxMajorIssues) : DEFAULT_QUALITY.maxMajorIssues,
    requireNoBlocking: c.requireNoBlocking ?? DEFAULT_QUALITY.requireNoBlocking,
    maxIterations: Number.isFinite(c.maxIterations) ? Number(c.maxIterations) : DEFAULT_QUALITY.maxIterations,
  };
}

export interface SectionEval {
  id: string;
  issues: SectionIssue[];
}

/** Does a single section clear the bar? */
export function sectionPasses(issues: SectionIssue[], config: QualityConfig): boolean {
  if (config.requireNoBlocking && issues.some((i) => i.severity === "blocking")) return false;
  const major = issues.filter((i) => i.severity === "major" || i.severity === "blocking").length;
  return major <= config.maxMajorIssues;
}

export interface GateResult {
  /** All sections clear the bar. */
  passed: boolean;
  /** Iteration cap reached — stop revising and ship what we have. */
  forced: boolean;
  /** Sections that still have issues and need another revision pass. */
  sectionsToRevise: string[];
}

/**
 * Evaluate the whole deliverable against its quality config at the current
 * iteration. `passed` when every section clears the bar; otherwise the failing
 * sections are returned for another pass — unless the iteration cap is hit, in
 * which case `forced` is true and production should finalize.
 */
export function evaluateQualityGates(
  sections: SectionEval[],
  iteration: number,
  config: QualityConfig
): GateResult {
  const failing = sections.filter((s) => !sectionPasses(s.issues, config)).map((s) => s.id);
  const passed = failing.length === 0;
  const forced = !passed && iteration >= config.maxIterations;
  return { passed, forced, sectionsToRevise: passed || forced ? [] : failing };
}
