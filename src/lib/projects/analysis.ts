import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { generation } from "@/lib/ai/generation";
import { db } from "@/lib/db";
import {
  organizations,
  projectKnowledgeItems,
  projectSources,
  projects,
  type Organization,
} from "@/lib/db/schema";

import { extractJson } from "@/lib/agents/json";
import { systemReply } from "@/lib/agents/subagent";
import {
  addEdge,
  addItem,
  embedOne,
  findRelatedItems,
  recordProjectEvent,
  reinforceItem,
  setItemStatus,
  type ItemType,
} from "./knowledge";

// The living-project analysis engine. When a source is added, fold it into the
// knowledge graph: extract typed items, reconcile each against what's already
// known (reinforce duplicates, relate/contradict/answer neighbors), then
// refresh the project's recommended next steps. Bounded to three model calls
// per source (extract, relate, recommend).

const ITEM_TYPES = ["fact", "claim", "insight", "assumption", "decision", "question", "risk"] as const;

const REINFORCE_SIMILARITY = 0.9; // near-duplicate → reinforce instead of adding
const RELATE_SIMILARITY = 0.55; // related enough to consider a relationship
const MAX_RELATION_PAIRS = 8;

// The persona every analysis subagent wears — a rigorous knowledge analyst.
const ANALYST_PERSONA =
  "You are the project's knowledge analyst. You extract atomic, well-classified knowledge, reconcile it against what is already known, and recommend the most valuable next steps. You are precise, evidence-driven, and never invent facts.";

const extractSchema = z.object({
  items: z
    .array(z.object({ type: z.enum(ITEM_TYPES), content: z.string().min(3).max(1000), confidence: z.number().min(0).max(1).optional() }))
    .max(14),
});

const relationSchema = z.object({
  relations: z.array(
    z.object({
      index: z.number().int(),
      relation: z.enum(["supports", "contradicts", "answers", "refines", "none"]),
      rationale: z.string().max(400).optional(),
    })
  ),
});

/** Sources still awaiting analysis — re-enqueued on restart for resumability. */
export async function pendingSourceIds(): Promise<string[]> {
  const rows = await db.query.projectSources.findMany({
    where: eq(projectSources.status, "pending"),
    columns: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function markSourceError(sourceId: string, message: string): Promise<void> {
  await db.update(projectSources).set({ status: "error", error: message }).where(eq(projectSources.id, sourceId));
}

/**
 * Analyze one project source into the knowledge graph. Idempotent per source
 * (only runs while `pending`), so it's safe to re-enqueue after a restart.
 */
export async function analyzeSource(sourceId: string): Promise<void> {
  const source = await db.query.projectSources.findFirst({ where: eq(projectSources.id, sourceId) });
  if (!source || source.status !== "pending") return;

  const project = await db.query.projects.findFirst({ where: eq(projects.id, source.projectId) });
  if (!project) return;
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, project.organizationId) });
  if (!org) return;

  // 1. Extract typed knowledge items from the source.
  const extractText = await systemReply(
    org,
    [
      `You are building the structured knowledge for the project "${project.title}".`,
      project.description ? `Project goal: ${project.description}` : "",
      "",
      `New source (${source.kind}): ${source.title}`,
      source.content.slice(0, 8000),
      "",
      "Extract the distinct, atomic pieces of knowledge this source establishes. Classify each as one of: fact, claim, insight, assumption, decision, question, risk. Keep each item a single self-contained statement.",
      'Respond with JSON only: {"items":[{"type":"...","content":"...","confidence":0.0-1.0}]}',
    ]
      .filter(Boolean)
      .join("\n"),
    { persona: ANALYST_PERSONA, gen: generation.extract }
  );
  const parsed = extractSchema.safeParse(extractJson(extractText));
  const extracted = parsed.success ? parsed.data.items : [];

  const newItems: { item: Awaited<ReturnType<typeof addItem>>; neighbors: { id: string; content: string; confidence: number; type: ItemType; status: string }[] }[] = [];

  for (const ex of extracted) {
    const emb = await embedOne(ex.content);
    const related = emb ? await findRelatedItems(source.projectId, emb.vector, emb.modelId, 5) : [];

    const dup = related.find((r) => r.similarity >= REINFORCE_SIMILARITY && r.item.type === ex.type);
    if (dup) {
      await reinforceItem(dup.item, { sourceId: source.id, snippet: ex.content });
      continue;
    }

    const item = await addItem({
      projectId: source.projectId,
      orgId: org.id,
      type: ex.type,
      content: ex.content,
      confidence: ex.confidence ?? 0.6,
      embedding: emb,
      evidence: { sourceId: source.id, snippet: ex.content },
    });
    const neighbors = related
      .filter((r) => r.similarity >= RELATE_SIMILARITY && r.similarity < REINFORCE_SIMILARITY)
      .map((r) => ({ id: r.item.id, content: r.item.content, confidence: r.item.confidence, type: r.item.type, status: r.item.status }));
    newItems.push({ item, neighbors });
  }

  // 2. Classify relationships between new items and their neighbors (one call).
  const pairs: { fromId: string; fromContent: string; fromType: ItemType; fromConfidence: number; toId: string; toContent: string; toType: ItemType; toConfidence: number; toStatus: string }[] = [];
  for (const n of newItems) {
    for (const nb of n.neighbors) {
      if (pairs.length >= MAX_RELATION_PAIRS) break;
      pairs.push({
        fromId: n.item.id,
        fromContent: n.item.content,
        fromType: n.item.type,
        fromConfidence: n.item.confidence,
        toId: nb.id,
        toContent: nb.content,
        toType: nb.type,
        toConfidence: nb.confidence,
        toStatus: nb.status,
      });
    }
  }

  if (pairs.length > 0) {
    const relText = await systemReply(
      org,
      [
        "For each numbered pair of statements (A = new, B = existing), classify how A relates to B: supports, contradicts, answers (A answers a question B), refines (A is a more precise version of B), or none.",
        "",
        ...pairs.map((p, i) => `${i}. A (${p.fromType}): ${p.fromContent}\n   B (${p.toType}): ${p.toContent}`),
        "",
        'Respond with JSON only: {"relations":[{"index":0,"relation":"supports|contradicts|answers|refines|none","rationale":"..."}]}',
      ].join("\n"),
      { persona: ANALYST_PERSONA, gen: generation.extract }
    );
    const relParsed = relationSchema.safeParse(extractJson(relText));
    for (const rel of relParsed.success ? relParsed.data.relations : []) {
      const pair = pairs[rel.index];
      if (!pair || rel.relation === "none") continue;
      await addEdge(source.projectId, pair.fromId, pair.toId, rel.relation, rel.rationale);

      if (rel.relation === "contradicts") {
        // Challenge the lower-confidence side.
        const loser =
          pair.fromConfidence <= pair.toConfidence
            ? await db.query.projectKnowledgeItems.findFirst({ where: eq(projectKnowledgeItems.id, pair.fromId) })
            : await db.query.projectKnowledgeItems.findFirst({ where: eq(projectKnowledgeItems.id, pair.toId) });
        if (loser && loser.status === "active") {
          await setItemStatus(loser, "challenged", "contradiction_found", `Contradiction: ${loser.content.slice(0, 120)}`);
        }
      } else if (rel.relation === "answers" && pair.toType === "question" && pair.toStatus !== "resolved") {
        const q = await db.query.projectKnowledgeItems.findFirst({ where: eq(projectKnowledgeItems.id, pair.toId) });
        if (q) await setItemStatus(q, "resolved", "question_answered", `Answered: ${q.content.slice(0, 120)}`);
      }
    }
  }

  // 3. Refresh the project's recommended next steps from current knowledge.
  await refreshNextSteps(project, org);

  await db.update(projectSources).set({ status: "analyzed", analyzedAt: new Date() }).where(eq(projectSources.id, sourceId));
  await db.update(projects).set({ lastAnalyzedAt: new Date(), updatedAt: new Date() }).where(eq(projects.id, project.id));
  await recordProjectEvent(project.id, "source_analyzed", `Analyzed source: ${source.title}`, { type: "source", id: source.id });
}

/** On-demand re-evaluation: refresh recommended next steps from current knowledge. */
export async function reevaluateProject(projectId: string): Promise<void> {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project) return;
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, project.organizationId) });
  if (!org) return;
  await refreshNextSteps(project, org);
}

/** Re-derive the recommended next steps from the project's active knowledge. */
export async function refreshNextSteps(
  project: { id: string; title: string; description: string | null },
  org: Organization
): Promise<void> {
  const items = await db.query.projectKnowledgeItems.findMany({
    where: and(eq(projectKnowledgeItems.projectId, project.id)),
    orderBy: (t, { desc }) => desc(t.updatedAt),
    limit: 60,
  });
  const active = items.filter((i) => i.status === "active" || i.status === "challenged");
  if (active.length === 0) return;

  const openQuestions = active.filter((i) => i.type === "question");
  const risks = active.filter((i) => i.type === "risk");
  const challenged = active.filter((i) => i.status === "challenged");

  const nextSteps = await systemReply(
    org,
    [
      `You are the lead on the project "${project.title}". Based on the project's current knowledge, recommend the most valuable next steps.`,
      project.description ? `Goal: ${project.description}` : "",
      "",
      "Current knowledge:",
      ...active.slice(0, 40).map((i) => `- [${i.type}${i.status === "challenged" ? ", CHALLENGED" : ""}] ${i.content}`),
      "",
      openQuestions.length ? `Open questions: ${openQuestions.length}. Risks: ${risks.length}. Challenged items: ${challenged.length}.` : "",
      "Write a short, prioritized list of recommended next steps (plain text, a few bullets). Address open questions, challenged assumptions, and risks first.",
    ]
      .filter(Boolean)
      .join("\n"),
    { persona: ANALYST_PERSONA, gen: generation.summary }
  );

  await db.update(projects).set({ nextSteps: nextSteps.trim(), updatedAt: new Date() }).where(eq(projects.id, project.id));
  await recordProjectEvent(project.id, "recommendation_updated", "Updated recommended next steps");
}
