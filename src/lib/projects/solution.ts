import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { generation } from "@/lib/ai/generation";
import { db } from "@/lib/db";
import { organizations, projects, solutions, type Organization, type Project, type Solution } from "@/lib/db/schema";

import { enqueueSolution } from "@/lib/agents/engine";
import { extractJson } from "@/lib/agents/json";
import { systemReply } from "@/lib/agents/subagent";
import { recordProjectEvent, retrieveProjectContext } from "./knowledge";
import {
  citationStats,
  deepResearch,
  evidenceBlock,
  evidenceSchema,
  researchRecordSchema,
  stripUnknownCitations,
  type CitationStats,
  type EvidenceItem,
  type ResearchRecord,
} from "./research";
import { parseCharter, scopeBlock } from "./scoping";

// The Solution engine — the spine of the app. From a project's brief + scope +
// knowledge it (1) diagnoses the REAL problem, (2) produces ONE structured
// answer, and (3) verifies that answer actually solves the problem, revising if
// not. Everything that ships (report, deck, model, one-pager) is rendered from
// this single model, so the formats can never disagree. DB-state-driven and
// re-entrant, so a run resumes cleanly after a restart.

const MAX_ITERATIONS = Number(process.env.LOOMAI_SOLUTION_MAX_ITER ?? 2);

// --- The three structured artifacts -----------------------------------------

export const problemSchema = z.object({
  coreProblem: z.string().min(3).max(1000),
  whyItMatters: z.string().max(1000).default(""),
  decision: z.string().max(600).default(""),
  solutionCriteria: z.array(z.string().max(300)).max(8).default([]),
});
export type Problem = z.infer<typeof problemSchema>;

export const solutionModelSchema = z.object({
  title: z.string().max(200).default("Solution"),
  executiveSummary: z.string().max(3000).default(""),
  recommendation: z.string().max(1500).default(""),
  findings: z.array(z.object({ title: z.string().max(200), detail: z.string().max(1200) })).max(10).default([]),
  analysis: z.array(z.object({ point: z.string().max(240), evidence: z.string().max(1000).default("") })).max(12).default([]),
  risks: z.array(z.object({ risk: z.string().max(240), mitigation: z.string().max(600).default("") })).max(8).default([]),
  plan: z.array(z.object({ step: z.string().max(200), detail: z.string().max(800).default(""), owner: z.string().max(120).default("") })).max(12).default([]),
  metrics: z.array(z.object({ name: z.string().max(160), value: z.string().max(120), note: z.string().max(300).default("") })).max(20).default([]),
});
export type SolutionModel = z.infer<typeof solutionModelSchema>;

export const verificationSchema = z.object({
  solvesProblem: z.boolean(),
  score: z.number().min(0).max(100).default(0),
  gaps: z.array(z.string().max(300)).max(10).default([]),
  fixes: z.array(z.string().max(300)).max(10).default([]),
});
export type Verification = z.infer<typeof verificationSchema>;

// Citable evidence the solution stands on lives with the research engine that
// produces it; re-exported here because it's part of the Solution's public shape.
export { evidenceSchema, researchRecordSchema, type EvidenceItem, type ResearchRecord };

const DIAGNOSER = "You are a razor-sharp strategy consultant. You cut through a brief to the REAL problem that must be solved — which is often not the question as asked — and define exactly what a good answer must achieve. You are precise and decisive.";
const SOLVER = "You are a principal consultant producing the definitive answer to a problem. You synthesize evidence into one coherent, decision-ready solution: a clear recommendation, the findings and analysis that support it, the risks, and a concrete plan. You are specific and never hand-wave.";
const VERIFIER = "You are a demanding reviewer. Your only question is whether the proposed solution actually solves the stated problem and meets its success criteria. You are honest about gaps and never rubber-stamp.";

// --- Lifecycle helpers ------------------------------------------------------

export async function activeSolutionIds(): Promise<string[]> {
  const rows = await db.query.solutions.findMany({ columns: { id: true, status: true } });
  return rows.filter((r) => !["completed", "failed"].includes(r.status)).map((r) => r.id);
}

export async function markSolutionFailed(id: string, message: string): Promise<void> {
  await db.update(solutions).set({ status: "failed", error: message, updatedAt: new Date() }).where(eq(solutions.id, id));
}

/** The project's latest solution, if any. */
export async function latestSolution(projectId: string): Promise<Solution | null> {
  return (
    (await db.query.solutions.findFirst({
      where: eq(solutions.projectId, projectId),
      orderBy: desc(solutions.createdAt),
    })) ?? null
  );
}

/** Start a fresh solve for a project and kick off the run. */
export async function startSolution(projectId: string, orgId: string, userId: string | null, research = true): Promise<string> {
  const [s] = await db
    .insert(solutions)
    .values({ projectId, organizationId: orgId, status: "diagnosing", researchMode: research, createdByUserId: userId ?? null })
    .returning();
  enqueueSolution(s.id);
  return s.id;
}

// --- The state machine ------------------------------------------------------

async function runRole(org: Organization, persona: string, prompt: string, gen = generation.work): Promise<string> {
  return systemReply(org, prompt, { persona, gen });
}

/** Advance a solution by one step and re-enqueue until terminal. */
export async function advanceSolution(solutionId: string): Promise<void> {
  const s = await db.query.solutions.findFirst({ where: eq(solutions.id, solutionId) });
  if (!s || s.status === "completed" || s.status === "failed") return;
  const project = await db.query.projects.findFirst({ where: eq(projects.id, s.projectId) });
  if (!project) return;
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, s.organizationId) });
  if (!org) return;

  let terminal = false;
  if (s.status === "diagnosing") await diagnose(s, project, org);
  else if (s.status === "researching") await research(s, project, org);
  else if (s.status === "solving" || s.status === "revising") await solve(s, project, org);
  else if (s.status === "verifying") terminal = await verify(s, project, org);

  if (!terminal) enqueueSolution(solutionId);
}

async function diagnose(s: Solution, project: Project, org: Organization): Promise<void> {
  const scope = scopeBlock(parseCharter(project.charter), project.description);
  const context = await retrieveProjectContext({ id: project.id, organizationId: org.id }, project.description ?? project.title).catch(() => "");

  const text = await runRole(
    org,
    DIAGNOSER,
    [
      `A project named "${project.title}" needs a decisive answer.`,
      scope ? `\n${scope}\n` : project.description ? `Brief: ${project.description}` : "",
      context ? `\nWhat the project knows:\n${context}\n` : "",
      "Diagnose the REAL core problem to solve (which may differ from the literal ask), why it matters, the key decision to be made, and the criteria a good solution must meet.",
      'Respond with JSON only: {"coreProblem":"...","whyItMatters":"...","decision":"...","solutionCriteria":["..."]}',
    ]
      .filter(Boolean)
      .join("\n"),
    generation.plan
  );
  const parsed = problemSchema.safeParse(extractJson(text));
  const problem: Problem = parsed.success
    ? parsed.data
    : { coreProblem: project.description?.trim() || project.title, whyItMatters: "", decision: "", solutionCriteria: [] };

  const next = s.researchMode ? "researching" : "solving";
  await db.update(solutions).set({ problem, status: next, updatedAt: new Date() }).where(eq(solutions.id, s.id));
  await recordProjectEvent(project.id, "solution_diagnosed", `Diagnosed the core problem: ${problem.coreProblem.slice(0, 120)}`, { type: "solution", id: s.id });
}

/**
 * The evidence phase. Decomposes the diagnosed problem into research questions
 * and works each one across the project's documents, its structured knowledge,
 * and the live web — chasing the questions that come back thin — then ranks the
 * result into the [E#] set the solver must cite. See ./research.
 */
async function research(s: Solution, project: Project, org: Organization): Promise<void> {
  const problem = problemSchema.parse(s.problem ?? {});
  const { evidence, record } = await deepResearch({
    org,
    projectId: project.id,
    coreProblem: problem.coreProblem,
    criteria: problem.solutionCriteria,
    scope: scopeBlock(parseCharter(project.charter), project.description),
  });

  await db.update(solutions).set({ evidence, research: record, status: "solving", updatedAt: new Date() }).where(eq(solutions.id, s.id));
  await recordProjectEvent(
    project.id,
    "solution_researched",
    `Researched ${record.questions.length} question${record.questions.length === 1 ? "" : "s"} over ${record.rounds} round${record.rounds === 1 ? "" : "s"} — ${evidence.length} sources (${record.counts.document} document, ${record.counts.knowledge} knowledge, ${record.counts.web} web)`,
    { type: "solution", id: s.id }
  );
}

/**
 * Every claim the solution asserts, as text. Used to check citation grounding —
 * these are the statements that must rest on evidence.
 */
function materialClaims(model: SolutionModel): string[] {
  return [
    ...model.findings.map((f) => `${f.title} ${f.detail}`),
    ...model.analysis.map((a) => `${a.point} ${a.evidence}`),
    ...model.metrics.map((m) => `${m.name} ${m.value} ${m.note}`),
  ].filter((c) => c.trim());
}

/**
 * Keep the model honest about its citations: drop [E#] tags that point at
 * evidence that doesn't exist, and measure how much of the solution is actually
 * grounded. Both results go to the verifier — a hallucinated tag is a
 * correctness failure, and an uncited claim is a gap.
 */
function enforceCitations(model: SolutionModel, evidence: EvidenceItem[]): { model: SolutionModel; stats: CitationStats } {
  const known = new Set(evidence.map((e) => e.id));
  const stats = citationStats(materialClaims(model), known);
  if (evidence.length === 0) return { model, stats };

  const clean = (text: string) => stripUnknownCitations(text, known);
  return {
    model: {
      ...model,
      executiveSummary: clean(model.executiveSummary),
      recommendation: clean(model.recommendation),
      findings: model.findings.map((f) => ({ title: clean(f.title), detail: clean(f.detail) })),
      analysis: model.analysis.map((a) => ({ point: clean(a.point), evidence: clean(a.evidence) })),
      risks: model.risks.map((r) => ({ risk: clean(r.risk), mitigation: clean(r.mitigation) })),
      plan: model.plan.map((p) => ({ ...p, step: clean(p.step), detail: clean(p.detail) })),
      metrics: model.metrics.map((m) => ({ ...m, note: clean(m.note) })),
    },
    stats,
  };
}

async function solve(s: Solution, project: Project, org: Organization): Promise<void> {
  const problem = problemSchema.parse(s.problem ?? {});
  const verification = s.verification ? verificationSchema.safeParse(s.verification) : null;
  const evidence = s.evidence ? evidenceSchema.safeParse(s.evidence).data ?? [] : [];
  const isRevision = s.status === "revising";
  const context = evidence.length === 0 ? await retrieveProjectContext({ id: project.id, organizationId: org.id }, problem.coreProblem).catch(() => "") : "";
  const block = evidenceBlock(evidence);

  const text = await runRole(
    org,
    SOLVER,
    [
      `Produce the definitive solution to this problem.`,
      `Core problem: ${problem.coreProblem}`,
      problem.decision ? `Key decision: ${problem.decision}` : "",
      problem.solutionCriteria.length ? `A good solution must: ${problem.solutionCriteria.join("; ")}` : "",
      block ? `\n${block}\n` : context ? `\nEvidence available:\n${context}\n` : "",
      isRevision && verification?.success && verification.data.fixes.length
        ? `Your previous attempt fell short. Fix these gaps:\n${verification.data.fixes.map((f) => `- ${f}`).join("\n")}`
        : "",
      "Deliver ONE coherent, decision-ready answer: a title, an executive summary, a single clear recommendation, the findings and analysis that support it, the key risks with mitigations, a concrete plan (steps, and owners where sensible), and any quantitative metrics that matter.",
      evidence.length
        ? `Every finding, analysis point, and metric must end with the [E#] tag(s) it rests on — only tags from E1–E${evidence.length}. If nothing in the evidence supports a point, leave the point out rather than asserting it uncited.`
        : "",
      'Respond with JSON only: {"title":"...","executiveSummary":"...","recommendation":"...","findings":[{"title":"...","detail":"..."}],"analysis":[{"point":"...","evidence":"..."}],"risks":[{"risk":"...","mitigation":"..."}],"plan":[{"step":"...","detail":"...","owner":"..."}],"metrics":[{"name":"...","value":"...","note":"..."}]}',
    ]
      .filter(Boolean)
      .join("\n"),
    generation.work
  );
  const parsed = solutionModelSchema.safeParse(extractJson(text));
  const drafted: SolutionModel = parsed.success ? parsed.data : { ...solutionModelSchema.parse({}), title: project.title, executiveSummary: problem.coreProblem };

  // Citations are checked, not trusted: invented [E#] tags are removed and the
  // grounding rate is recorded for the verifier.
  const { model, stats } = enforceCitations(drafted, evidence);
  const record = s.research ? researchRecordSchema.safeParse(s.research).data ?? null : null;
  const research = record ? { ...record, citation: stats } : null;

  await db
    .update(solutions)
    .set({ model, ...(research ? { research } : {}), status: "verifying", updatedAt: new Date() })
    .where(eq(solutions.id, s.id));
  await recordProjectEvent(
    project.id,
    isRevision ? "solution_revised" : "solution_drafted",
    `${isRevision ? "Revised" : "Drafted"} the solution${evidence.length ? ` — ${stats.coverage}% of claims cited` : ""}`,
    { type: "solution", id: s.id }
  );
}

async function verify(s: Solution, project: Project, org: Organization): Promise<boolean> {
  const problem = problemSchema.parse(s.problem ?? {});
  const model = solutionModelSchema.parse(s.model ?? {});
  const evidence = s.evidence ? evidenceSchema.safeParse(s.evidence).data ?? [] : [];
  const record = s.research ? researchRecordSchema.safeParse(s.research).data ?? null : null;
  const stats = record?.citation ?? null;

  // Questions the research phase couldn't answer are known blind spots — the
  // reviewer should weigh the solution knowing where it's standing on nothing.
  const unanswered = (record?.questions ?? []).filter((q) => q.found === 0).map((q) => q.question);

  const text = await runRole(
    org,
    VERIFIER,
    [
      "Judge whether this solution actually solves the problem and meets its success criteria.",
      `Core problem: ${problem.coreProblem}`,
      problem.solutionCriteria.length ? `Success criteria: ${problem.solutionCriteria.join("; ")}` : "",
      "",
      "Solution:",
      `Recommendation: ${model.recommendation}`,
      `Executive summary: ${model.executiveSummary}`,
      model.findings.length ? `Findings: ${model.findings.map((f) => `${f.title} — ${f.detail}`).join("\n")}` : "",
      model.analysis.length ? `Analysis: ${model.analysis.map((a) => a.point).join("; ")}` : "",
      model.plan.length ? `Plan: ${model.plan.map((p) => p.step).join("; ")}` : "",
      evidence.length ? `\nThe evidence available to the author was:\n${evidence.map((e) => `[${e.id}] (${e.source}) ${e.snippet}`).join("\n")}` : "",
      stats
        ? `\nGrounding: ${stats.cited} of ${stats.claims} claims carry a citation (${stats.coverage}%).${stats.unknownRefs.length ? ` The author also referenced non-existent evidence: ${stats.unknownRefs.join(", ")}.` : ""}`
        : "",
      unanswered.length ? `\nResearch could not answer: ${unanswered.join("; ")}` : "",
      evidence.length
        ? "\nHold it to the evidence: a material claim with no citation, or one the cited evidence does not actually support, is a gap. Say so plainly."
        : "",
      "",
      'Respond with JSON only: {"solvesProblem":true|false,"score":0-100,"gaps":["..."],"fixes":["..."]}',
    ]
      .filter(Boolean)
      .join("\n"),
    generation.extract
  );
  const parsed = verificationSchema.safeParse(extractJson(text));
  const verification: Verification = parsed.success ? parsed.data : { solvesProblem: true, score: 70, gaps: [], fixes: [] };

  // A solution that cites evidence that doesn't exist has failed on its face,
  // whatever the reviewer thought of the prose.
  if (stats && stats.unknownRefs.length > 0 && verification.solvesProblem) {
    verification.solvesProblem = false;
    verification.gaps = [...verification.gaps, `Cited evidence that does not exist: ${stats.unknownRefs.join(", ")}`].slice(0, 10);
    verification.fixes = [...verification.fixes, "Cite only the listed [E#] evidence, and drop any claim it does not support"].slice(0, 10);
  }

  const cap = s.iteration >= MAX_ITERATIONS;
  const done = verification.solvesProblem || cap;

  if (done) {
    await db.update(solutions).set({ verification, status: "completed", updatedAt: new Date() }).where(eq(solutions.id, s.id));
    await recordProjectEvent(
      project.id,
      "solution_completed",
      verification.solvesProblem ? `Solution verified (score ${verification.score})` : `Solution finalized at the iteration cap (score ${verification.score})`,
      { type: "solution", id: s.id }
    );
    return true;
  }

  await db.update(solutions).set({ verification, status: "revising", iteration: s.iteration + 1, updatedAt: new Date() }).where(eq(solutions.id, s.id));
  await recordProjectEvent(project.id, "solution_gap", `Verification found gaps — revising (${verification.gaps.length})`, { type: "solution", id: s.id });
  return false;
}
