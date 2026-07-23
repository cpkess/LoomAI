import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { generation } from "@/lib/ai/generation";
import { db } from "@/lib/db";
import { conversations, messages, organizations, projects, type Organization, type Project } from "@/lib/db/schema";
import { extractJson } from "@/lib/agents/json";
import { systemReply } from "@/lib/agents/subagent";

import { DELIVERABLE_KINDS, type DeliverableKind } from "./deliverableKinds";
import { addItem, recordProjectEvent, retrieveProjectContext } from "./knowledge";
import { refreshNextSteps } from "./analysis";
import type { ItemType } from "./knowledge";

// The scoping loop turns an initial prompt into a real, actionable work plan.
// A scoping subagent drafts a structured **charter** from the brief, refines it
// as the user answers a few questions, and — once accepted — seeds the project's
// knowledge graph (objective, open questions, assumptions, risks) and sets the
// recommended next steps. One prompt bootstraps a fully-populated project.

export const SCOPER_PERSONA = [
  "You are a sharp project strategist running a scoping session. Your job is to turn a rough initial brief into a crisp, actionable work plan.",
  "Be opinionated and do the thinking: propose a concrete plan first, then ask only the 2–4 most decision-relevant questions (objective, scope boundaries, audience, and the deliverables that would make this a success).",
  "Never interrogate the user with a long list of questions. Prefer proposing sensible defaults they can correct. Keep answers tight.",
].join(" ");

// Deliverable kind is validated leniently — an unknown kind falls back to a
// report rather than failing the whole charter.
const deliverableSchema = z.object({
  title: z.string().min(1).max(200),
  kind: z.string().max(40).default("report"),
  brief: z.string().max(800).default(""),
});

export const charterSchema = z.object({
  objective: z.string().max(800).default(""),
  successCriteria: z.array(z.string().max(300)).max(8).default([]),
  scope: z
    .object({
      inScope: z.array(z.string().max(300)).max(12).default([]),
      outOfScope: z.array(z.string().max(300)).max(12).default([]),
    })
    .default({ inScope: [], outOfScope: [] }),
  audience: z.string().max(300).default(""),
  keyQuestions: z.array(z.string().max(300)).max(12).default([]),
  assumptions: z.array(z.string().max(300)).max(10).default([]),
  risks: z.array(z.string().max(300)).max(10).default([]),
  approach: z.array(z.string().max(300)).max(12).default([]),
  deliverables: z.array(deliverableSchema).max(8).default([]),
  evidenceNeeded: z.array(z.string().max(300)).max(10).default([]),
});

export type Charter = z.infer<typeof charterSchema>;

export const EMPTY_CHARTER: Charter = charterSchema.parse({});

/** Coerce a stored charter (jsonb) into a validated Charter, or null. */
export function parseCharter(raw: unknown): Charter | null {
  if (!raw) return null;
  const parsed = charterSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Normalize a charter deliverable's kind to a known deliverable kind. */
export function normalizeKind(kind: string): DeliverableKind {
  return (DELIVERABLE_KINDS as readonly string[]).includes(kind) ? (kind as DeliverableKind) : "report";
}

/**
 * Pure: the project's objective + scope as a grounding block, so anything the
 * project produces (deliverables, analysis) stays on-target and in-scope. Falls
 * back to the raw brief when there's no charter yet.
 */
export function scopeBlock(charter: Charter | null, description: string | null): string {
  const lines: string[] = [];
  const objective = charter?.objective?.trim() || description?.trim();
  if (objective) lines.push(`Objective: ${objective}`);
  if (charter?.audience?.trim()) lines.push(`Audience: ${charter.audience.trim()}`);
  if (charter?.scope?.inScope?.length) lines.push(`In scope: ${charter.scope.inScope.join("; ")}`);
  if (charter?.scope?.outOfScope?.length) lines.push(`Out of scope (do not cover): ${charter.scope.outOfScope.join("; ")}`);
  if (charter?.successCriteria?.length) lines.push(`Success criteria: ${charter.successCriteria.join("; ")}`);
  if (charter?.keyQuestions?.length) lines.push(`Key questions to address: ${charter.keyQuestions.join("; ")}`);
  if (lines.length === 0) return "";
  return `Project objective and scope (stay strictly within this):\n${lines.join("\n")}`;
}

/**
 * Pure: the knowledge items a finalized charter seeds. The objective anchors the
 * project as a decision; open questions, assumptions, and risks become live
 * items so the project's intelligence (gaps, investigations) is populated from
 * the very first prompt.
 */
export function charterToSeedItems(charter: Charter): { type: ItemType; content: string; confidence: number }[] {
  const items: { type: ItemType; content: string; confidence: number }[] = [];
  if (charter.objective.trim()) items.push({ type: "decision", content: `Objective: ${charter.objective.trim()}`, confidence: 0.8 });
  for (const q of charter.keyQuestions) if (q.trim()) items.push({ type: "question", content: q.trim(), confidence: 0.6 });
  for (const a of charter.assumptions) if (a.trim()) items.push({ type: "assumption", content: a.trim(), confidence: 0.5 });
  for (const r of charter.risks) if (r.trim()) items.push({ type: "risk", content: r.trim(), confidence: 0.5 });
  return items;
}

/** Get (or lazily create) the project's scoping conversation for a user. */
export async function ensureScopingConversation(projectId: string, userId: string): Promise<string> {
  const existing = await db.query.conversations.findFirst({
    where: and(eq(conversations.projectId, projectId), eq(conversations.kind, "scoping"), eq(conversations.userId, userId)),
  });
  if (existing) return existing.id;
  const [created] = await db
    .insert(conversations)
    .values({ projectId, userId, kind: "scoping", title: "Project scoping" })
    .returning();
  return created.id;
}

/** The scoping conversation transcript, formatted for the drafting prompt. */
async function scopingTranscript(conversationId: string): Promise<string> {
  const rows = await db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: asc(messages.createdAt),
  });
  if (rows.length === 0) return "(no conversation yet)";
  return rows.map((m) => `${m.role === "user" ? "User" : "Scoper"}: ${m.content}`).join("\n\n");
}

/**
 * Draft (or re-draft) the work plan from the brief + scoping conversation so
 * far. Deterministic fallback keeps the objective from the brief if the model
 * doesn't return clean JSON.
 */
export async function draftCharter(project: Project, org: Organization, conversationId: string): Promise<Charter> {
  const transcript = await scopingTranscript(conversationId);
  const context = await retrieveProjectContext({ id: project.id, organizationId: org.id }, project.description ?? project.title).catch(() => "");

  const text = await systemReply(
    org,
    [
      `Draft the work plan for a project titled "${project.title}".`,
      project.description ? `Initial brief:\n${project.description}` : "",
      context ? `\nWhat the project already knows:\n${context}\n` : "",
      `\nScoping conversation so far:\n${transcript}`,
      "",
      "Produce a complete, sensible plan even where the user hasn't specified — use reasonable defaults and mark uncertain items as assumptions or open questions.",
      "Deliverable kinds must be one of: " + DELIVERABLE_KINDS.join(", ") + ".",
      'Respond with JSON only in this shape: {"objective":"...","successCriteria":["..."],"scope":{"inScope":["..."],"outOfScope":["..."]},"audience":"...","keyQuestions":["..."],"assumptions":["..."],"risks":["..."],"approach":["..."],"deliverables":[{"title":"...","kind":"report","brief":"..."}],"evidenceNeeded":["..."]}',
    ]
      .filter(Boolean)
      .join("\n"),
    { persona: SCOPER_PERSONA, gen: generation.plan }
  );

  const parsed = charterSchema.safeParse(extractJson(text));
  if (parsed.success && (parsed.data.objective.trim() || parsed.data.keyQuestions.length > 0)) return parsed.data;
  return { ...EMPTY_CHARTER, objective: project.description?.trim() || project.title };
}

/** Persist a freshly-drafted charter without finalizing the project. */
export async function saveCharter(projectId: string, charter: Charter): Promise<void> {
  await db.update(projects).set({ charter, updatedAt: new Date() }).where(eq(projects.id, projectId));
}

/**
 * Finalize scoping: persist the (possibly user-edited) charter, seed the
 * knowledge graph from it, refresh recommended next steps, and move the project
 * from scoping ("planning") to "in_progress".
 */
export async function finalizeScoping(projectId: string, charter: Charter, userId: string | null): Promise<Charter> {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project) throw new Error("Project not found");
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, project.organizationId) });
  if (!org) throw new Error("Organization not found");

  await db.update(projects).set({ charter, status: "in_progress", updatedAt: new Date() }).where(eq(projects.id, projectId));

  for (const seed of charterToSeedItems(charter)) {
    await addItem({ projectId, orgId: org.id, type: seed.type, content: seed.content, confidence: seed.confidence }).catch((err) =>
      console.error("charter seed failed", err)
    );
  }

  await recordProjectEvent(
    projectId,
    "scoping_completed",
    `Work plan set${charter.objective ? `: ${charter.objective.slice(0, 120)}` : ""}`
  );
  await refreshNextSteps(project, org).catch((err) => console.error("refreshNextSteps failed", err));

  return charter;
}
