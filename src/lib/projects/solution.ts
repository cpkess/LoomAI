import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { generation } from "@/lib/ai/generation";
import { db } from "@/lib/db";
import { organizations, projects, solutions, type Organization, type Project, type Solution } from "@/lib/db/schema";

import { enqueueSolution } from "@/lib/agents/engine";
import { extractJson } from "@/lib/agents/json";
import { subagentForRole } from "@/lib/agents/roles";
import { systemReply, webResearchEnabled } from "@/lib/agents/subagent";
import { retrieveContext } from "@/lib/rag/retrieve";
import { embedOne, findRelatedItems, projectCollectionId, recordProjectEvent, retrieveProjectContext } from "./knowledge";
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

// Citable evidence the solution stands on. Each item gets an [E#] tag the solver
// references, so every claim is traceable to a source (a document, a project
// knowledge item, or a web page).
export const evidenceSchema = z.array(
  z.object({
    id: z.string().max(8),
    snippet: z.string().max(1200),
    source: z.string().max(300),
    kind: z.string().max(40),
    ref: z.string().nullable().optional(),
  })
);
export type EvidenceItem = z.infer<typeof evidenceSchema>[number];

const webEvidenceSchema = z.object({
  evidence: z.array(z.object({ claim: z.string().max(600), source: z.string().max(400).default("") })).max(8).default([]),
});

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
 * Gather citable evidence for the diagnosed problem: excerpts from the project's
 * own documents, its knowledge items, and — when web research is enabled — a few
 * web findings. Each becomes an [E#] the solver can cite, so every claim is
 * traceable.
 */
async function research(s: Solution, project: Project, org: Organization): Promise<void> {
  const problem = problemSchema.parse(s.problem ?? {});
  const query = problem.coreProblem;
  const raw: Omit<EvidenceItem, "id">[] = [];

  // 1. Document excerpts from the project's own sources.
  try {
    const collectionId = await projectCollectionId(project.id, org.id);
    const retrieved = await retrieveContext([collectionId], query);
    for (const src of retrieved.sources.slice(0, 8)) {
      raw.push({ snippet: src.snippet, source: src.filename, kind: "document", ref: src.documentId });
    }
  } catch (err) {
    console.error("evidence: document retrieval failed", err);
  }

  // 2. The project's structured knowledge.
  try {
    const emb = await embedOne(query);
    if (emb) {
      const related = await findRelatedItems(project.id, emb.vector, emb.modelId, 8);
      for (const r of related) {
        if (r.item.status === "superseded") continue;
        raw.push({ snippet: r.item.content, source: "project knowledge", kind: r.item.type, ref: r.item.id });
      }
    }
  } catch (err) {
    console.error("evidence: knowledge retrieval failed", err);
  }

  // 3. Web findings, when the org has web research on.
  if (webResearchEnabled(org)) {
    try {
      const persona = subagentForRole("researcher").persona;
      const text = await systemReply(
        org,
        [
          `Research the web for concrete, current evidence relevant to this problem: "${query}".`,
          "Return only well-sourced facts, each with the URL it came from. Do not invent sources.",
          'Respond with JSON only: {"evidence":[{"claim":"...","source":"<url>"}]}',
        ].join("\n"),
        { persona, gen: generation.extract, withTools: true }
      );
      const parsed = webEvidenceSchema.safeParse(extractJson(text));
      if (parsed.success) {
        for (const e of parsed.data.evidence) if (e.claim.trim()) raw.push({ snippet: e.claim, source: e.source || "web", kind: "web", ref: null });
      }
    } catch (err) {
      console.error("evidence: web research failed", err);
    }
  }

  // Number and cap.
  const evidence: EvidenceItem[] = raw.slice(0, 14).map((e, i) => ({ ...e, id: `E${i + 1}` }));

  await db.update(solutions).set({ evidence, status: "solving", updatedAt: new Date() }).where(eq(solutions.id, s.id));
  await recordProjectEvent(project.id, "solution_researched", `Gathered ${evidence.length} pieces of evidence`, { type: "solution", id: s.id });
}

async function solve(s: Solution, project: Project, org: Organization): Promise<void> {
  const problem = problemSchema.parse(s.problem ?? {});
  const verification = s.verification ? verificationSchema.safeParse(s.verification) : null;
  const evidence = s.evidence ? evidenceSchema.safeParse(s.evidence).data ?? [] : [];
  const isRevision = s.status === "revising";
  const context = evidence.length === 0 ? await retrieveProjectContext({ id: project.id, organizationId: org.id }, problem.coreProblem).catch(() => "") : "";

  const evidenceBlock = evidence.length
    ? [
        "Evidence — cite the pieces that support each claim using their [E#] tag (in findings, analysis points, and metric notes). Do not invent evidence or sources:",
        ...evidence.map((e) => `[${e.id}] (${e.source}) ${e.snippet}`),
      ].join("\n")
    : "";

  const text = await runRole(
    org,
    SOLVER,
    [
      `Produce the definitive solution to this problem.`,
      `Core problem: ${problem.coreProblem}`,
      problem.decision ? `Key decision: ${problem.decision}` : "",
      problem.solutionCriteria.length ? `A good solution must: ${problem.solutionCriteria.join("; ")}` : "",
      evidenceBlock ? `\n${evidenceBlock}\n` : context ? `\nEvidence available:\n${context}\n` : "",
      isRevision && verification?.success && verification.data.fixes.length
        ? `Your previous attempt fell short. Fix these gaps:\n${verification.data.fixes.map((f) => `- ${f}`).join("\n")}`
        : "",
      "Deliver ONE coherent, decision-ready answer: a title, an executive summary, a single clear recommendation, the findings and analysis that support it, the key risks with mitigations, a concrete plan (steps, and owners where sensible), and any quantitative metrics that matter.",
      evidence.length ? "Cite the evidence behind each finding, analysis point, and metric using its [E#] tag." : "",
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
