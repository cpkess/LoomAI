import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { generation } from "@/lib/ai/generation";
import { db } from "@/lib/db";
import { projectKnowledgeEvidence, projectSources, type Organization } from "@/lib/db/schema";

import { extractJson } from "@/lib/agents/json";
import { subagentForRole } from "@/lib/agents/roles";
import { systemReply, webResearchEnabled } from "@/lib/agents/subagent";
import { retrieveHybrid } from "@/lib/rag/retrieve";
import { navigate } from "@/lib/research/navigate";
import { browserAvailable, fetchReadable, webSearch } from "@/lib/research/web";

import { embedOne, findRelatedItems, projectCollectionId } from "./knowledge";

// Deep research — the evidence phase the Solution stands on.
//
// The shallow version asked one flat question, took whatever came back, and let
// the model recall its own web sources (which it invents). This does real
// research instead:
//
//   1. DECOMPOSE  the problem into specific research questions, each with the
//      search phrasings that would answer it.
//   2. GATHER     per question, across three channels — the project's own
//      documents (scored chunks), its structured knowledge (with the source it
//      actually came from), and the live web.
//   3. ASSESS     which questions came back thin, and generate sharper follow-up
//      queries for them.
//   4. REPEAT     for a bounded number of rounds.
//   5. RANK       dedupe, score, and cap with per-channel quotas so one loud
//      channel can't crowd the others out.
//
// Web sourcing is deterministic: we run the search ourselves, fetch the actual
// pages, and extract claims *from the fetched text*. The model never supplies a
// URL, so every [E#] points at a page that really exists and really said it.

const ROUNDS = Number(process.env.LOOMAI_RESEARCH_ROUNDS ?? 2);
const MAX_QUESTIONS = Number(process.env.LOOMAI_RESEARCH_QUESTIONS ?? 5);
const MAX_EVIDENCE = Number(process.env.LOOMAI_RESEARCH_MAX_EVIDENCE ?? 18);
const WEB_PAGES_PER_QUESTION = Number(process.env.LOOMAI_RESEARCH_WEB_PAGES ?? 3);
const CONCURRENCY = Number(process.env.LOOMAI_RESEARCH_CONCURRENCY ?? 3);
// Evidence is held to a higher bar than chat retrieval: a barely-related chunk
// carrying an [E#] tag looks grounded while adding nothing, which is worse than
// having no evidence at all.
const EVIDENCE_MIN_SIM = Number(process.env.LOOMAI_EVIDENCE_MIN_SIM ?? 0.45);

// --- Shapes -----------------------------------------------------------------

export const researchQuestionSchema = z.object({
  question: z.string().min(3).max(400),
  why: z.string().max(400).default(""),
  queries: z.array(z.string().max(200)).max(3).default([]),
});
export type ResearchQuestion = z.infer<typeof researchQuestionSchema>;

export const researchPlanSchema = z.object({
  questions: z.array(researchQuestionSchema).max(8).default([]),
});

/**
 * Citable evidence. Each item carries an [E#] tag the solver references, plus
 * enough identity to check it: what said it, where that lives, and how relevant
 * it scored.
 */
export const evidenceSchema = z.array(
  z.object({
    id: z.string().max(8),
    snippet: z.string().max(1200),
    /** Human-readable source identity — a filename, a page title, a source doc. */
    source: z.string().max(300),
    /** "document" | "knowledge" | "web" — the channel it came from. */
    kind: z.string().max(40),
    /** Internal pointer (documentId / knowledge item id), when there is one. */
    ref: z.string().nullable().optional(),
    /** Resolvable URL, for web evidence. */
    url: z.string().max(600).nullable().optional(),
    /** 0–1 relevance. */
    score: z.number().min(0).max(1).default(0),
    /** The research question this answers. */
    question: z.string().max(400).default(""),
  })
);
export type EvidenceItem = z.infer<typeof evidenceSchema>[number];
type Candidate = Omit<EvidenceItem, "id">;

/** What the research phase did — shown in the UI and fed to the verifier. */
export const researchRecordSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().max(400),
        why: z.string().max(400).default(""),
        found: z.number().default(0),
      })
    )
    .default([]),
  rounds: z.number().default(0),
  counts: z.object({ document: z.number().default(0), knowledge: z.number().default(0), web: z.number().default(0) }).default({
    document: 0,
    knowledge: 0,
    web: 0,
  }),
  /**
   * Sources we found but could not read — CAPTCHAs, bot walls, paywalls, logins.
   * Recorded so "no evidence exists" is never confused with "we couldn't get in".
   */
  blocked: z
    .array(z.object({ url: z.string().max(600), reason: z.string().max(40), detail: z.string().max(200).default("") }))
    .max(20)
    .default([]),
  /** Filled in after the solve, once citations can be checked. */
  citation: z
    .object({
      claims: z.number().default(0),
      cited: z.number().default(0),
      coverage: z.number().default(0),
      unknownRefs: z.array(z.string().max(8)).default([]),
    })
    .nullable()
    .default(null),
});
export type ResearchRecord = z.infer<typeof researchRecordSchema>;

const PLANNER =
  "You are a research lead. You break a problem into the specific, answerable questions whose answers would settle it — the things you'd actually need to look up. You never ask vague questions.";
const EXTRACTOR =
  "You extract evidence from source text. You only report what the text actually says, quoting or closely paraphrasing it. You never add outside knowledge and never invent numbers.";

// --- Pure helpers (unit-tested) ---------------------------------------------

/** Collapse a snippet to a stable key for near-duplicate detection. */
export function dedupeKey(snippet: string): string {
  return snippet.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Drop repeats of the same finding, keeping the highest-scoring copy. */
export function dedupeEvidence<T extends Candidate>(items: T[]): T[] {
  const best = new Map<string, T>();
  for (const item of items) {
    const key = `${item.url ?? item.source}|${dedupeKey(item.snippet)}`;
    const existing = best.get(key);
    if (!existing || (item.score ?? 0) > (existing.score ?? 0)) best.set(key, item);
  }
  return [...best.values()];
}

/**
 * Rank and cap. Sorting by score alone lets one channel (usually document
 * chunks, which always score high) fill every slot, so we take each channel's
 * best in rotation until the cap — every channel gets a voice, order stays
 * score-descending within a channel.
 */
export function rankEvidence<T extends Candidate>(items: T[], max = MAX_EVIDENCE): T[] {
  const byKind = new Map<string, T[]>();
  for (const item of items) byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]);
  for (const list of byKind.values()) list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const kinds = [...byKind.keys()].sort();
  const picked: T[] = [];
  for (let round = 0; picked.length < max; round++) {
    let addedThisRound = false;
    for (const kind of kinds) {
      const list = byKind.get(kind)!;
      if (round >= list.length || picked.length >= max) continue;
      picked.push(list[round]);
      addedThisRound = true;
    }
    if (!addedThisRound) break;
  }
  return picked.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/** Assign the [E1]…[E#] tags the solver cites. */
export function numberEvidence(items: Candidate[]): EvidenceItem[] {
  return items.map((e, i) => ({ ...e, id: `E${i + 1}` }));
}

/** Every [E#] tag referenced in a piece of text. */
export function extractCitations(text: string): string[] {
  return [...text.matchAll(/\[(E\d+)\]/gi)].map((m) => m[1].toUpperCase());
}

/** Strip [E#] tags that point at evidence that doesn't exist. */
export function stripUnknownCitations(text: string, known: Set<string>): string {
  return text
    .replace(/\[(E\d+)\]/gi, (tag, id: string) => (known.has(id.toUpperCase()) ? tag : ""))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

export interface CitationStats {
  claims: number;
  cited: number;
  coverage: number;
  unknownRefs: string[];
}

/**
 * How well the claims are grounded: what fraction carry a citation, and which
 * referenced tags don't exist. Both feed the verifier — an uncited claim is a
 * gap, and a hallucinated tag is a correctness failure.
 */
export function citationStats(claims: string[], known: Set<string>): CitationStats {
  const unknown = new Set<string>();
  let cited = 0;
  for (const claim of claims) {
    const refs = extractCitations(claim);
    for (const ref of refs) if (!known.has(ref)) unknown.add(ref);
    if (refs.some((r) => known.has(r))) cited++;
  }
  const claimCount = claims.length;
  return {
    claims: claimCount,
    cited,
    coverage: claimCount === 0 ? 0 : Math.round((cited / claimCount) * 100),
    unknownRefs: [...unknown].sort(),
  };
}

/** A deterministic plan, used when the planner is unavailable or unparseable. */
export function fallbackPlan(coreProblem: string, criteria: string[]): ResearchQuestion[] {
  const questions: ResearchQuestion[] = [{ question: coreProblem, why: "The core problem itself", queries: [coreProblem] }];
  for (const c of criteria.slice(0, MAX_QUESTIONS - 1)) {
    questions.push({ question: c, why: "A stated success criterion", queries: [c] });
  }
  return questions;
}

// --- Bounded parallelism ----------------------------------------------------

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        out[index] = await fn(items[index]);
      } catch (err) {
        console.error("research: task failed", err);
        out[index] = undefined as R;
      }
    }
  });
  await Promise.all(workers);
  return out.filter((r) => r !== undefined);
}

// --- Step 1: decompose ------------------------------------------------------

async function planResearch(org: Organization, coreProblem: string, criteria: string[], scope: string): Promise<ResearchQuestion[]> {
  try {
    const text = await systemReply(
      org,
      [
        `Problem to settle: ${coreProblem}`,
        criteria.length ? `A good answer must: ${criteria.join("; ")}` : "",
        scope ? `\n${scope}\n` : "",
        `Break this into at most ${MAX_QUESTIONS} specific research questions whose answers would settle it. For each, give the search phrasings you would actually use.`,
        'Respond with JSON only: {"questions":[{"question":"...","why":"...","queries":["...","..."]}]}',
      ]
        .filter(Boolean)
        .join("\n"),
      { persona: PLANNER, gen: generation.plan }
    );
    const parsed = researchPlanSchema.safeParse(extractJson(text));
    const questions = parsed.success ? parsed.data.questions.filter((q) => q.question.trim()) : [];
    if (questions.length > 0) return questions.slice(0, MAX_QUESTIONS);
  } catch (err) {
    console.error("research: planning failed", err);
  }
  return fallbackPlan(coreProblem, criteria);
}

/** Sharper queries for the questions that came back thin. */
async function refineQueries(org: Organization, thin: ResearchQuestion[], found: string[]): Promise<Map<string, string[]>> {
  const refined = new Map<string, string[]>();
  if (thin.length === 0) return refined;
  try {
    const text = await systemReply(
      org,
      [
        "These research questions came back with little or no usable evidence:",
        ...thin.map((q) => `- ${q.question}`),
        found.length ? `\nWhat we did find so far:\n${found.slice(0, 8).map((f) => `- ${f}`).join("\n")}\n` : "",
        "For each question, propose up to 2 different search phrasings likely to surface evidence the earlier attempt missed. Use different wording, synonyms, or a narrower angle.",
        'Respond with JSON only: {"questions":[{"question":"<the question, verbatim>","queries":["...","..."]}]}',
      ].join("\n"),
      { persona: PLANNER, gen: generation.plan }
    );
    const parsed = researchPlanSchema.safeParse(extractJson(text));
    if (parsed.success) {
      for (const q of parsed.data.questions) {
        if (q.queries.length) refined.set(q.question.trim().toLowerCase(), q.queries);
      }
    }
  } catch (err) {
    console.error("research: query refinement failed", err);
  }
  return refined;
}

// --- Step 2: the three gathering channels -----------------------------------

/**
 * Documents that restate the brief rather than inform it. The brief is the
 * question; citing it as evidence for its own answer is circular and
 * manufactures the appearance of support, so it's kept out of the pool.
 */
async function briefDocumentIds(projectId: string, description: string | null): Promise<Set<string>> {
  const brief = (description ?? "").trim();
  if (!brief) return new Set();
  try {
    const rows = await db.query.projectSources.findMany({
      where: eq(projectSources.projectId, projectId),
      columns: { ref: true, content: true },
    });
    return new Set(rows.filter((r) => r.ref && r.content.trim() === brief).map((r) => r.ref!));
  } catch (err) {
    console.error("research: brief lookup failed", err);
    return new Set();
  }
}

/** The project's own documents, as scored chunks. */
async function gatherDocuments(
  projectId: string,
  orgId: string,
  question: string,
  query: string,
  exclude: Set<string>
): Promise<Candidate[]> {
  try {
    const collectionId = await projectCollectionId(projectId, orgId);
    const hits = (await retrieveHybrid([collectionId], query, 8)).filter(
      (h) => !exclude.has(h.documentId) && h.similarity >= EVIDENCE_MIN_SIM
    );
    return hits.slice(0, 4).map((h) => ({
      snippet: h.content.length > 700 ? `${h.content.slice(0, 697)}…` : h.content,
      source: h.filename,
      kind: "document",
      ref: h.documentId,
      url: null,
      score: Math.max(0, Math.min(1, h.similarity)),
      question,
    }));
  } catch (err) {
    console.error("research: document retrieval failed", err);
    return [];
  }
}

/**
 * The project's structured knowledge — attributed to the source it was actually
 * extracted from, not the generic "project knowledge".
 */
async function gatherKnowledge(projectId: string, question: string, query: string): Promise<Candidate[]> {
  try {
    const emb = await embedOne(query);
    if (!emb) return [];
    const related = await findRelatedItems(projectId, emb.vector, emb.modelId, 6);
    const usable = related.filter((r) => r.item.status !== "superseded" && r.similarity >= EVIDENCE_MIN_SIM);
    if (usable.length === 0) return [];

    // Resolve each item's originating source so the citation names a real thing.
    const originById = new Map<string, string>();
    try {
      const rows = await db
        .select({ itemId: projectKnowledgeEvidence.itemId, sourceId: projectKnowledgeEvidence.sourceId })
        .from(projectKnowledgeEvidence)
        .where(
          inArray(
            projectKnowledgeEvidence.itemId,
            usable.map((r) => r.item.id)
          )
        )
        .orderBy(desc(projectKnowledgeEvidence.createdAt));
      const sourceIds = [...new Set(rows.map((r) => r.sourceId).filter((id): id is string => Boolean(id)))];
      if (sourceIds.length > 0) {
        const sources = await db.query.projectSources.findMany({ where: inArray(projectSources.id, sourceIds) });
        const titleById = new Map(sources.map((s) => [s.id, s.title]));
        for (const row of rows) {
          if (originById.has(row.itemId) || !row.sourceId) continue;
          const title = titleById.get(row.sourceId);
          if (title) originById.set(row.itemId, title);
        }
      }
    } catch (err) {
      console.error("research: knowledge provenance lookup failed", err);
    }

    return usable.map((r) => {
      const origin = originById.get(r.item.id);
      return {
        snippet: r.item.content,
        source: origin ? `${origin} (project knowledge)` : `Project knowledge — ${r.item.type}`,
        kind: "knowledge",
        ref: r.item.id,
        url: null,
        score: Math.max(0, Math.min(1, r.similarity)),
        question,
      };
    });
  } catch (err) {
    console.error("research: knowledge retrieval failed", err);
    return [];
  }
}

const pageEvidenceSchema = z.object({
  evidence: z.array(z.object({ claim: z.string().max(700) })).max(3).default([]),
});

/** A source we could not read, and why. Reported rather than silently dropped. */
export interface BlockedSource {
  url: string;
  reason: string;
  detail: string;
}

/** The outside world, injectable so the sourcing rules can be tested offline. */
export interface WebDeps {
  search: (query: string, limit: number) => Promise<{ title: string; url: string; snippet: string }[]>;
  fetchPage: (url: string) => Promise<{ title: string; text: string; blocked?: { reason: string; detail: string } | null }>;
  extract: (question: string, pageText: string) => Promise<string[]>;
}

function liveWebDeps(org: Organization): WebDeps {
  return {
    search: webSearch,
    // Cheap fetch first; escalate to a real browser only when that comes back
    // empty — which usually means JS-rendered content or a consent overlay.
    // If the browser finds an access gate, we stop and say so.
    fetchPage: async (url) => {
      try {
        const page = await fetchReadable(url);
        if ((page.text ?? "").trim().length >= 500) return { title: page.title, text: page.text ?? "" };
      } catch {
        /* fall through to the browser */
      }
      if (!browserAvailable()) throw new Error("page unreadable without a browser");
      const nav = await navigate(url);
      if (nav.blocked) return { title: nav.title, text: "", blocked: nav.blocked };
      return { title: nav.title, text: nav.text };
    },
    extract: async (question, pageText) => {
      const text = await systemReply(
        org,
        [
          `Research question: ${question}`,
          "Below is the text of a web page. Extract up to 2 specific claims from it that help answer the question — figures, dates, named facts. Quote or closely paraphrase the page. If the page does not address the question, return an empty list.",
          "",
          `PAGE TEXT:\n${pageText.slice(0, 6000)}`,
          "",
          'Respond with JSON only: {"evidence":[{"claim":"..."}]}',
        ].join("\n"),
        { persona: EXTRACTOR, gen: generation.extract }
      );
      const parsed = pageEvidenceSchema.safeParse(extractJson(text));
      return parsed.success ? parsed.data.evidence.map((e) => e.claim.trim()).filter(Boolean) : [];
    },
  };
}

/**
 * The live web. We drive this ourselves — search, then fetch the actual pages,
 * then extract claims from the fetched text. The model only ever summarizes text
 * we handed it, so it cannot invent a source: the URL and title come from the
 * fetch, not the model. A page that won't load still yields its search snippet,
 * which is a real excerpt from a real result — better than dropping the source.
 */
export async function gatherWeb(
  org: Organization,
  question: string,
  queries: string[],
  deps?: WebDeps,
  onBlocked?: (blocked: BlockedSource) => void
): Promise<Candidate[]> {
  const { search, fetchPage, extract } = deps ?? liveWebDeps(org);
  const seen = new Set<string>();
  const results: { title: string; url: string; snippet: string }[] = [];

  for (const query of queries.slice(0, 2)) {
    try {
      for (const r of await search(query, 5)) {
        if (!r.url || seen.has(r.url)) continue;
        try {
          new URL(r.url); // a citation has to resolve
        } catch {
          continue;
        }
        seen.add(r.url);
        results.push(r);
      }
    } catch (err) {
      console.error("research: web search failed", err);
    }
    if (results.length >= WEB_PAGES_PER_QUESTION) break;
  }
  if (results.length === 0) return [];

  const pages = results.slice(0, WEB_PAGES_PER_QUESTION);
  return (
    await mapLimit(pages, CONCURRENCY, async (result): Promise<Candidate[]> => {
      let title = result.title || result.url;
      let text = "";
      try {
        const page = await fetchPage(result.url);
        title = page.title || title;
        text = page.text ?? "";
        if (page.blocked) {
          // An access gate, not content. Record it and leave the site alone —
          // we do not retry, and we never cite a page we could not read.
          onBlocked?.({ url: result.url, reason: page.blocked.reason, detail: page.blocked.detail });
          return [];
        }
      } catch {
        if (!result.snippet.trim()) return [];
        return [{ snippet: result.snippet.trim(), source: title, kind: "web", ref: null, url: result.url, score: 0.5, question }];
      }
      if (text.trim().length < 200) return [];

      const claims = await extract(question, text);
      return claims.map((claim) => ({
        snippet: claim,
        source: title,
        kind: "web",
        ref: null,
        url: result.url,
        score: 0.72, // fetched-and-confirmed, below a strong local match
        question,
      }));
    })
  ).flat();
}

// --- The loop ---------------------------------------------------------------

export interface DeepResearchInput {
  org: Organization;
  projectId: string;
  coreProblem: string;
  criteria: string[];
  scope: string;
  /** The project's brief, so it can be excluded from its own evidence. */
  description?: string | null;
}

export interface DeepResearchResult {
  evidence: EvidenceItem[];
  record: ResearchRecord;
}

/**
 * Run the full research phase: decompose, gather across channels, assess what
 * came back thin, chase it, then rank and number the result.
 */
export async function deepResearch(input: DeepResearchInput): Promise<DeepResearchResult> {
  const { org, projectId, coreProblem, criteria, scope } = input;
  const questions = await planResearch(org, coreProblem, criteria, scope);
  const web = webResearchEnabled(org);
  const excluded = await briefDocumentIds(projectId, input.description ?? null);

  let pool: Candidate[] = [];
  let roundsRun = 0;
  const blocked = new Map<string, BlockedSource>();
  // Per question, the queries to try this round.
  let queue = questions.map((q) => ({ q, queries: q.queries.length ? q.queries : [q.question] }));

  for (let round = 0; round < Math.max(1, ROUNDS) && queue.length > 0; round++) {
    roundsRun = round + 1;

    const gathered = await mapLimit(queue, CONCURRENCY, async ({ q, queries }) => {
      const primary = queries[0] ?? q.question;
      const [docs, knowledge, webHits] = await Promise.all([
        gatherDocuments(projectId, org.id, q.question, primary, excluded),
        gatherKnowledge(projectId, q.question, primary),
        web
          ? gatherWeb(org, q.question, queries, undefined, (b) => blocked.set(b.url, b))
          : Promise.resolve([] as Candidate[]),
      ]);
      return [...docs, ...knowledge, ...webHits];
    });
    pool = dedupeEvidence([...pool, ...gathered.flat()]);

    // Which questions are still thin? Chase those, and only those.
    const thin = questions.filter((q) => pool.filter((e) => e.question === q.question).length < 2);
    if (thin.length === 0 || round + 1 >= Math.max(1, ROUNDS)) break;

    const refined = await refineQueries(
      org,
      thin,
      pool.map((e) => e.snippet.slice(0, 160))
    );
    queue = thin
      .map((q) => {
        const next = refined.get(q.question.trim().toLowerCase()) ?? q.queries.slice(1);
        return { q, queries: next };
      })
      .filter((entry) => entry.queries.length > 0);
  }

  const evidence = numberEvidence(rankEvidence(pool, MAX_EVIDENCE));
  const counts = { document: 0, knowledge: 0, web: 0 };
  for (const e of evidence) {
    if (e.kind === "document") counts.document++;
    else if (e.kind === "web") counts.web++;
    else counts.knowledge++;
  }

  const record: ResearchRecord = researchRecordSchema.parse({
    questions: questions.map((q) => ({
      question: q.question,
      why: q.why,
      found: evidence.filter((e) => e.question === q.question).length,
    })),
    rounds: roundsRun,
    counts,
    blocked: [...blocked.values()].slice(0, 20),
    citation: null,
  });

  return { evidence, record };
}

/** Build the prompt block that tells the solver what it may cite. */
export function evidenceBlock(evidence: EvidenceItem[]): string {
  if (evidence.length === 0) return "";
  return [
    "EVIDENCE — every finding, analysis point, and metric must cite the [E#] tags it rests on. Cite only tags listed here; never invent a tag or a source.",
    ...evidence.map((e) => `[${e.id}] (${e.source}${e.url ? ` — ${e.url}` : ""}) ${e.snippet}`),
  ].join("\n");
}
