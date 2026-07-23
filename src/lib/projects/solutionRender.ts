import type { DeckSpec } from "@/lib/export/pptx";
import type { WorkbookSpec } from "@/lib/export/xlsx";

import type { EvidenceItem, Problem, SolutionModel } from "./solution";

// One Solution model → every format. These are pure functions, so the report,
// the deck, the workbook, and the one-pager can never disagree: they all read
// the same source. This is the product's core promise made literal.

export const SOLUTION_FORMATS = ["report", "onepager", "deck", "model", "pdf", "docx", "html", "md"] as const;
export type SolutionFormat = (typeof SOLUTION_FORMATS)[number];

/** The full report as Markdown (also the source for PDF/DOCX/HTML). */
export function solutionToMarkdown(problem: Problem | null, model: SolutionModel, evidence: EvidenceItem[] = []): string {
  const out: string[] = [`# ${model.title || "Solution"}`];

  if (model.executiveSummary) out.push(`## Executive summary\n\n${model.executiveSummary}`);

  if (problem?.coreProblem) {
    const bits = [`**Problem:** ${problem.coreProblem}`];
    if (problem.decision) bits.push(`**Decision:** ${problem.decision}`);
    if (problem.solutionCriteria?.length) bits.push(`**Success criteria:** ${problem.solutionCriteria.join("; ")}`);
    out.push(`## The problem\n\n${bits.join("\n\n")}`);
  }

  if (model.recommendation) out.push(`## Recommendation\n\n${model.recommendation}`);

  if (model.findings.length) {
    out.push(`## Findings\n\n${model.findings.map((f) => `### ${f.title}\n\n${f.detail}`).join("\n\n")}`);
  }
  if (model.analysis.length) {
    out.push(`## Analysis\n\n${model.analysis.map((a) => `- **${a.point}**${a.evidence ? ` — ${a.evidence}` : ""}`).join("\n")}`);
  }
  if (model.risks.length) {
    out.push(`## Risks\n\n${model.risks.map((r) => `- **${r.risk}**${r.mitigation ? ` — *Mitigation:* ${r.mitigation}` : ""}`).join("\n")}`);
  }
  if (model.plan.length) {
    out.push(
      `## Plan\n\n${model.plan.map((p, i) => `${i + 1}. **${p.step}**${p.owner ? ` (${p.owner})` : ""}${p.detail ? ` — ${p.detail}` : ""}`).join("\n")}`
    );
  }
  if (model.metrics.length) {
    const rows = model.metrics.map((m) => `| ${m.name} | ${m.value} | ${m.note} |`).join("\n");
    out.push(`## Key metrics\n\n| Metric | Value | Note |\n| --- | --- | --- |\n${rows}`);
  }

  if (evidence.length) {
    out.push(`## Sources\n\n${evidence.map((e) => `- **[${e.id}]** *(${e.source})* — ${e.snippet}`).join("\n")}`);
  }

  return out.join("\n\n");
}

/** A tight one-page brief for busy readers. */
export function solutionToOnePager(problem: Problem | null, model: SolutionModel): string {
  const out: string[] = [`# ${model.title || "Solution"} — one-pager`];
  if (problem?.coreProblem) out.push(`**Problem:** ${problem.coreProblem}`);
  if (model.recommendation) out.push(`**Recommendation:** ${model.recommendation}`);
  else if (model.executiveSummary) out.push(model.executiveSummary);
  if (model.findings.length) out.push(`**Key findings**\n\n${model.findings.slice(0, 4).map((f) => `- ${f.title}`).join("\n")}`);
  if (model.risks.length) out.push(`**Top risks**\n\n${model.risks.slice(0, 3).map((r) => `- ${r.risk}`).join("\n")}`);
  if (model.plan.length) out.push(`**Next steps**\n\n${model.plan.slice(0, 5).map((p) => `- ${p.step}`).join("\n")}`);
  if (model.metrics.length) out.push(`**Metrics:** ${model.metrics.slice(0, 5).map((m) => `${m.name} ${m.value}`).join(" · ")}`);
  return out.join("\n\n");
}

/** The presentation deck spec (rendered to .pptx). */
export function solutionToDeck(problem: Problem | null, model: SolutionModel, evidence: EvidenceItem[] = []): DeckSpec {
  const slides: DeckSpec["slides"] = [];

  if (model.executiveSummary) {
    slides.push({ title: "Executive summary", bullets: splitToBullets(model.executiveSummary), notes: model.executiveSummary });
  }
  if (problem?.coreProblem) {
    slides.push({
      title: "The problem",
      bullets: [problem.coreProblem, problem.decision && `Decision: ${problem.decision}`, ...(problem.solutionCriteria ?? []).map((c) => `Success: ${c}`)].filter(Boolean) as string[],
    });
  }
  if (model.recommendation) {
    slides.push({ title: "Recommendation", bullets: splitToBullets(model.recommendation) });
  }
  if (model.findings.length) {
    slides.push({ title: "Findings", bullets: model.findings.map((f) => f.title), notes: model.findings.map((f) => `${f.title}: ${f.detail}`).join("\n") });
  }
  if (model.analysis.length) {
    slides.push({ title: "Analysis", bullets: model.analysis.map((a) => a.point) });
  }
  if (model.risks.length) {
    slides.push({ title: "Risks & mitigations", bullets: model.risks.map((r) => `${r.risk}${r.mitigation ? ` → ${r.mitigation}` : ""}`) });
  }
  if (model.plan.length) {
    slides.push({ title: "Plan", bullets: model.plan.map((p) => `${p.step}${p.owner ? ` (${p.owner})` : ""}`) });
  }
  if (model.metrics.length) {
    slides.push({ title: "Key metrics", bullets: model.metrics.map((m) => `${m.name}: ${m.value}`) });
  }
  if (evidence.length) {
    slides.push({ title: "Sources", bullets: evidence.map((e) => `[${e.id}] ${e.source}`) });
  }

  return { title: model.title || "Solution", subtitle: model.recommendation ? truncate(model.recommendation, 140) : problem?.coreProblem, slides };
}

/** The workbook spec (rendered to .xlsx). */
export function solutionToWorkbook(model: SolutionModel, evidence: EvidenceItem[] = []): WorkbookSpec {
  const sheets: WorkbookSpec["sheets"] = [];

  if (model.metrics.length) {
    sheets.push({ name: "Metrics", columns: ["Metric", "Value", "Note"], rows: model.metrics.map((m) => [m.name, m.value, m.note]) });
  }
  if (model.plan.length) {
    sheets.push({ name: "Plan", columns: ["#", "Step", "Owner", "Detail"], rows: model.plan.map((p, i) => [String(i + 1), p.step, p.owner, p.detail]) });
  }
  if (model.risks.length) {
    sheets.push({ name: "Risks", columns: ["Risk", "Mitigation"], rows: model.risks.map((r) => [r.risk, r.mitigation]) });
  }
  if (model.findings.length) {
    sheets.push({ name: "Findings", columns: ["Finding", "Detail"], rows: model.findings.map((f) => [f.title, f.detail]) });
  }
  if (evidence.length) {
    sheets.push({ name: "Sources", columns: ["ID", "Source", "Kind", "Evidence"], rows: evidence.map((e) => [e.id, e.source, e.kind, e.snippet]) });
  }
  if (sheets.length === 0) sheets.push({ name: "Summary", columns: ["Item"], rows: [[model.title || "Solution"]] });

  return { title: model.title || "Solution", sheets };
}

function splitToBullets(text: string, max = 6): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return (sentences.length > 1 ? sentences : text.split("\n").map((s) => s.trim()).filter(Boolean)).slice(0, max);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
