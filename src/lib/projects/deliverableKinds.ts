// The kinds of deliverable a project can produce. Prose kinds run the Markdown
// multi-stage pipeline; structured kinds (presentation, workbook) plan a typed
// spec and render a native binary. Extending this list + adding a renderer is
// how new artifact formats land — the engine branches on `structuredKind`.

export const PROSE_KINDS = [
  "report",
  "strategy",
  "prd",
  "research_summary",
  "proposal",
  "memo",
  "exec_summary",
  "decision_memo",
] as const;

export const STRUCTURED_KINDS = ["presentation", "workbook"] as const;

export const DELIVERABLE_KINDS = [...PROSE_KINDS, ...STRUCTURED_KINDS] as const;

export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];
export type StructuredKind = (typeof STRUCTURED_KINDS)[number];

/** True for kinds that render to a native binary (pptx/xlsx) via a typed spec. */
export function structuredKind(kind: string): StructuredKind | null {
  return (STRUCTURED_KINDS as readonly string[]).includes(kind) ? (kind as StructuredKind) : null;
}

/** Human labels for the deliverable kinds (UI + prompts). */
export const KIND_LABELS: Record<DeliverableKind, string> = {
  report: "Report",
  strategy: "Business strategy",
  prd: "Product Requirements Document",
  research_summary: "Research summary",
  proposal: "Proposal",
  memo: "Memo",
  exec_summary: "Executive summary",
  decision_memo: "Decision memo",
  presentation: "Presentation (PowerPoint)",
  workbook: "Workbook (Excel)",
};
