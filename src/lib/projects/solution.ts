import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { generation } from "@/lib/ai/generation";
import { db } from "@/lib/db";
import { organizations, projects, solutions, type Organization, type Project, type Solution } from "@/lib/db/schema";

import { enqueueSolution } from "@/lib/agents/engine";
import { generateStructured } from "@/lib/agents/structured";
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

// The solve runs in three stages rather than one call. Two reasons: a 32k local
// model asked for the whole model at once produces markedly less consistent
// output (and truncates), and — more importantly — writing the recommendation
// in the same breath as the findings means nothing forces the recommendation to
// follow from them. Evidence first, conclusion second, actions third.
const findingsStageSchema = z.object({
  findings: solutionModelSchema.shape.findings,
  analysis: solutionModelSchema.shape.analysis,
});
const conclusionStageSchema = z.object({
  title: solutionModelSchema.shape.title,
  recommendation: solutionModelSchema.shape.recommendation,
  executiveSummary: solutionModelSchema.shape.executiveSummary,
});
const actionStageSchema = z.object({
  risks: solutionModelSchema.shape.risks,
  plan: solutionModelSchema.shape.plan,
  metrics: solutionModelSchema.shape.metrics,
});

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

/**
 * Another round, steered by the user: "you looked at X, now look at Y".
 *
 * This is not a re-solve. The previous round is kept intact and its evidence is
 * carried forward, so a follow-up builds on what was already established rather
 * than paying to rediscover it. The feedback drives the new research questions
 * and constrains the new answer.
 *
 * Re-diagnosing is deliberate: a steer like "actually, the real question is
 * whether we should partner instead" changes what the problem *is*, and the
 * round would be worthless if the diagnosis were frozen from the first pass.
 */
export async function continueSolution(
  projectId: string,
  orgId: string,
  userId: string | null,
  direction: string,
  research = true
): Promise<string> {
  const previous = await latestSolution(projectId);
  if (!previous) return startSolution(projectId, orgId, userId, research);

  const [s] = await db
    .insert(solutions)
    .values({
      projectId,
      organizationId: orgId,
      status: "diagnosing",
      researchMode: research,
      createdByUserId: userId ?? null,
      direction: direction.trim(),
      parentSolutionId: previous.id,
      round: (previous.round ?? 1) + 1,
      // Carried so the research phase can build on it; renumbered when merged.
      evidence: previous.evidence ?? null,
    })
    .returning();

  await recordProjectEvent(projectId, "solution_round", `Round ${s.round}: ${direction.trim().slice(0, 160)}`, { type: "solution", id: s.id });
  enqueueSolution(s.id);
  return s.id;
}

/** The answer this round is following on from, for context in prompts. */
async function previousRound(s: Solution): Promise<Solution | null> {
  if (!s.parentSolutionId) return null;
  return (await db.query.solutions.findFirst({ where: eq(solutions.id, s.parentSolutionId) })) ?? null;
}

// --- The state machine ------------------------------------------------------

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

  const prior = await previousRound(s);
  const priorProblem = prior?.problem ? problemSchema.safeParse(prior.problem).data ?? null : null;

  const problem = await generateStructured({
    org,
    persona: DIAGNOSER,
    label: "solution.diagnose",
    schema: problemSchema,
    gen: generation.plan,
    prompt: [
      `A project named "${project.title}" needs a decisive answer.`,
      scope ? `\n${scope}\n` : project.description ? `Brief: ${project.description}` : "",
      context ? `\nWhat the project knows:\n${context}\n` : "",
      s.direction
        ? [
            "",
            "This is a FOLLOW-UP round. The problem was previously diagnosed as:",
            `  "${priorProblem?.coreProblem ?? "(unrecorded)"}"`,
            "The user has since directed the work:",
            `  "${s.direction}"`,
            "Re-diagnose in light of that steer. If it changes what the real problem is, say so — do not simply restate the earlier diagnosis.",
          ].join("\n")
        : "",
      "Diagnose the REAL core problem to solve (which may differ from the literal ask), why it matters, the key decision to be made, and the criteria a good solution must meet.",
      'Respond with JSON only: {"coreProblem":"...","whyItMatters":"...","decision":"...","solutionCriteria":["..."]}',
    ]
      .filter(Boolean)
      .join("\n"),
  });

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
  // On a follow-up round the row was seeded with the previous round's evidence.
  const priorEvidence = s.evidence ? evidenceSchema.safeParse(s.evidence).data ?? [] : [];

  const { evidence, record } = await deepResearch({
    org,
    projectId: project.id,
    coreProblem: problem.coreProblem,
    criteria: problem.solutionCriteria,
    scope: scopeBlock(parseCharter(project.charter), project.description),
    description: project.description,
    direction: s.direction,
    priorEvidence,
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

  // A steered round: the user's direction outranks the previous answer, and the
  // previous answer is shown only so this round doesn't repeat it.
  const prior = await previousRound(s);
  const priorModel = prior?.model ? solutionModelSchema.safeParse(prior.model).data ?? null : null;
  const steer = s.direction
    ? [
        "",
        "THIS IS A FOLLOW-UP ROUND, requested by the user:",
        `  "${s.direction}"`,
        priorModel?.recommendation ? `The previous round recommended: "${priorModel.recommendation}"` : "",
        "Address the user's direction. Where the new evidence supports a different conclusion, say so plainly and change the recommendation — do not defend the earlier answer out of consistency.",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  // Shared framing every stage sees, so the three calls stay on the same problem.
  const framing = [
    `Core problem: ${problem.coreProblem}`,
    problem.decision ? `Key decision: ${problem.decision}` : "",
    problem.solutionCriteria.length ? `A good solution must: ${problem.solutionCriteria.join("; ")}` : "",
    steer,
    block ? `\n${block}\n` : context ? `\nEvidence available:\n${context}\n` : "",
    isRevision && verification?.success && verification.data.fixes.length
      ? `A previous attempt fell short. Fix these gaps:\n${verification.data.fixes.map((f) => `- ${f}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const citeRule = evidence.length
    ? `Every point must end with the [E#] tag(s) it rests on — only tags from E1–E${evidence.length}. If the evidence does not support a point, leave it out rather than asserting it uncited.`
    : "";

  // Stage 1 — what the evidence actually says. This runs first so the
  // conclusion has to be derived from it rather than asserted alongside it.
  const stage1 = await generateStructured({
    org,
    persona: SOLVER,
    label: "solution.findings",
    schema: findingsStageSchema,
    gen: generation.work,
    prompt: [
      "Establish what the evidence supports for this problem. Do not state a recommendation yet.",
      framing,
      "Give the substantive findings (each a titled claim with its detail) and the analysis points that follow from them.",
      citeRule,
      'Respond with JSON only: {"findings":[{"title":"...","detail":"..."}],"analysis":[{"point":"...","evidence":"..."}]}',
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const established = [
    stage1.findings.length ? `Findings:\n${stage1.findings.map((f) => `- ${f.title}: ${f.detail}`).join("\n")}` : "",
    stage1.analysis.length ? `Analysis:\n${stage1.analysis.map((a) => `- ${a.point}${a.evidence ? ` (${a.evidence})` : ""}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Stage 2 — the conclusion, constrained to what stage 1 established.
  const stage2 = await generateStructured({
    org,
    persona: SOLVER,
    label: "solution.recommendation",
    schema: conclusionStageSchema,
    gen: generation.summary,
    prompt: [
      "Draw the conclusion these findings lead to.",
      framing,
      `\nWhat has been established:\n${established || "(nothing was established — say so plainly rather than inventing support)"}\n`,
      "Give a short title for the solution, ONE clear recommendation, and an executive summary. The recommendation must follow from the findings above — do not introduce claims they do not support.",
      'Respond with JSON only: {"title":"...","recommendation":"...","executiveSummary":"..."}',
    ].join("\n"),
  });

  // Stage 3 — what to do about it, given the conclusion.
  const stage3 = await generateStructured({
    org,
    persona: SOLVER,
    label: "solution.plan",
    schema: actionStageSchema,
    gen: generation.work,
    prompt: [
      "Turn this decision into action.",
      framing,
      `\nRecommendation: ${stage2.recommendation}`,
      established ? `\n${established}\n` : "",
      "Give the key risks with mitigations, a concrete plan (steps, detail, and owners where sensible), and the quantitative metrics that matter.",
      citeRule,
      'Respond with JSON only: {"risks":[{"risk":"...","mitigation":"..."}],"plan":[{"step":"...","detail":"...","owner":"..."}],"metrics":[{"name":"...","value":"...","note":"..."}]}',
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const drafted: SolutionModel = { ...stage2, ...stage1, ...stage3 };

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

  const verification = await generateStructured({
    org,
    persona: VERIFIER,
    label: "solution.verify",
    schema: verificationSchema,
    gen: generation.extract,
    prompt: [
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
  });

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
