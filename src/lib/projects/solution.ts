import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { generation } from "@/lib/ai/generation";
import { db } from "@/lib/db";
import { organizations, projects, solutions, type Organization, type Project, type Solution } from "@/lib/db/schema";

import { enqueueSolution } from "@/lib/agents/engine";
import { extractJson } from "@/lib/agents/json";
import { systemReply } from "@/lib/agents/subagent";
import { recordProjectEvent, retrieveProjectContext } from "./knowledge";
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
export async function startSolution(projectId: string, orgId: string, userId: string | null): Promise<string> {
  const [s] = await db
    .insert(solutions)
    .values({ projectId, organizationId: orgId, status: "diagnosing", createdByUserId: userId ?? null })
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

  await db.update(solutions).set({ problem, status: "solving", updatedAt: new Date() }).where(eq(solutions.id, s.id));
  await recordProjectEvent(project.id, "solution_diagnosed", `Diagnosed the core problem: ${problem.coreProblem.slice(0, 120)}`, { type: "solution", id: s.id });
}

async function solve(s: Solution, project: Project, org: Organization): Promise<void> {
  const problem = problemSchema.parse(s.problem ?? {});
  const verification = s.verification ? verificationSchema.safeParse(s.verification) : null;
  const isRevision = s.status === "revising";
  const context = await retrieveProjectContext({ id: project.id, organizationId: org.id }, problem.coreProblem).catch(() => "");

  const text = await runRole(
    org,
    SOLVER,
    [
      `Produce the definitive solution to this problem.`,
      `Core problem: ${problem.coreProblem}`,
      problem.decision ? `Key decision: ${problem.decision}` : "",
      problem.solutionCriteria.length ? `A good solution must: ${problem.solutionCriteria.join("; ")}` : "",
      context ? `\nEvidence available:\n${context}\n` : "",
      isRevision && verification?.success && verification.data.fixes.length
        ? `Your previous attempt fell short. Fix these gaps:\n${verification.data.fixes.map((f) => `- ${f}`).join("\n")}`
        : "",
      "Deliver ONE coherent, decision-ready answer: a title, an executive summary, a single clear recommendation, the findings and analysis that support it, the key risks with mitigations, a concrete plan (steps, and owners where sensible), and any quantitative metrics that matter.",
      'Respond with JSON only: {"title":"...","executiveSummary":"...","recommendation":"...","findings":[{"title":"...","detail":"..."}],"analysis":[{"point":"...","evidence":"..."}],"risks":[{"risk":"...","mitigation":"..."}],"plan":[{"step":"...","detail":"...","owner":"..."}],"metrics":[{"name":"...","value":"...","note":"..."}]}',
    ]
      .filter(Boolean)
      .join("\n"),
    generation.work
  );
  const parsed = solutionModelSchema.safeParse(extractJson(text));
  const model: SolutionModel = parsed.success ? parsed.data : { ...solutionModelSchema.parse({}), title: project.title, executiveSummary: problem.coreProblem };

  await db.update(solutions).set({ model, status: "verifying", updatedAt: new Date() }).where(eq(solutions.id, s.id));
  await recordProjectEvent(project.id, isRevision ? "solution_revised" : "solution_drafted", `${isRevision ? "Revised" : "Drafted"} the solution`, { type: "solution", id: s.id });
}

async function verify(s: Solution, project: Project, org: Organization): Promise<boolean> {
  const problem = problemSchema.parse(s.problem ?? {});
  const model = solutionModelSchema.parse(s.model ?? {});

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
      model.findings.length ? `Findings: ${model.findings.map((f) => f.title).join("; ")}` : "",
      model.plan.length ? `Plan: ${model.plan.map((p) => p.step).join("; ")}` : "",
      "",
      'Respond with JSON only: {"solvesProblem":true|false,"score":0-100,"gaps":["..."],"fixes":["..."]}',
    ]
      .filter(Boolean)
      .join("\n"),
    generation.extract
  );
  const parsed = verificationSchema.safeParse(extractJson(text));
  const verification: Verification = parsed.success ? parsed.data : { solvesProblem: true, score: 70, gaps: [], fixes: [] };

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
