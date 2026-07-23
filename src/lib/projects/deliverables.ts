import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { generation } from "@/lib/ai/generation";
import { db } from "@/lib/db";
import {
  deliverableEvents,
  deliverableSections,
  deliverables,
  organizations,
  projects,
  type Deliverable,
  type DeliverableSection,
  type Organization,
} from "@/lib/db/schema";

import { enqueueDeliverable } from "@/lib/agents/engine";
import { extractJson } from "@/lib/agents/json";
import { subagentForRole, type Role } from "@/lib/agents/roles";
import { systemReply } from "@/lib/agents/subagent";
import { limits } from "@/lib/ai/generation";
import { slideFromMarkdown, type DeckSpec } from "@/lib/export/pptx";
import { sheetFromMarkdown, type WorkbookSpec } from "@/lib/export/xlsx";
import { structuredKind } from "./deliverableKinds";
import { recordProjectEvent, retrieveProjectContext } from "./knowledge";
import { parseCharter, scopeBlock } from "./scoping";
import { addSource } from "./sources";
import { evaluateQualityGates, resolveQualityConfig, type SectionIssue } from "./quality";

// Per-format guidance so a presentation plans slides and a workbook plans
// sheets, while prose kinds stay prose. Extending a format = add a case here
// plus a renderer.
function outlineGuidance(kind: string): string {
  const s = structuredKind(kind);
  if (s === "presentation") return "Each section is a SLIDE: the heading is the slide title, and the brief says what 3–6 bullet points it should make.";
  if (s === "workbook") return "Each section is a WORKSHEET: the heading is the sheet name, and the brief describes the columns and the rows it should contain.";
  return "";
}

function sectionGuidance(kind: string): string {
  const s = structuredKind(kind);
  if (s === "presentation") return "Write this slide as 3–6 concise bullet points, one per line starting with '- '. No paragraphs, no heading.";
  if (s === "workbook") return "Write this worksheet as a single Markdown table: a header row of column names, then the data rows. Output only the table.";
  return "Write only this section's content in Markdown (no top-level heading — it will be added on assembly).";
}

// The multi-stage deliverable engine: a DB-state-driven, re-entrant state
// machine. Each tick performs one bounded unit of work (plan the outline, draft
// a section, critique a section, run the quality gate, or assemble) and
// re-enqueues itself until the deliverable is complete. Because all state lives
// in the DB, a run resumes cleanly after a restart.

const outlineSchema = z.object({
  sections: z.array(z.object({ heading: z.string().min(2).max(200), brief: z.string().min(2).max(1000) })).min(1).max(12),
});

const critiqueSchema = z.object({
  issues: z
    .array(z.object({ kind: z.string().max(60), detail: z.string().max(500), severity: z.enum(["minor", "major", "blocking"]) }))
    .max(10),
});

const gapSchema = z.object({
  issues: z.array(z.object({ kind: z.string().max(60), detail: z.string().max(500), severity: z.enum(["minor", "major", "blocking"]) })).max(10).optional(),
  addSections: z.array(z.object({ heading: z.string().min(2).max(200), brief: z.string().min(2).max(1000) })).max(4).optional(),
});

async function dEvent(deliverableId: string, kind: string, summary: string, sectionId?: string, role?: string): Promise<void> {
  await db.insert(deliverableEvents).values({ deliverableId, kind, summary, sectionId: sectionId ?? null, role: role ?? null });
}

/** Non-terminal deliverables — re-enqueued on restart for resumability. */
export async function activeDeliverableIds(): Promise<string[]> {
  const rows = await db.query.deliverables.findMany({ columns: { id: true, status: true } });
  return rows.filter((r) => !["completed", "failed", "cancelled"].includes(r.status)).map((r) => r.id);
}

export async function markDeliverableFailed(id: string, message: string): Promise<void> {
  await db.update(deliverables).set({ status: "failed", error: message, updatedAt: new Date() }).where(eq(deliverables.id, id));
}

/** Run one specialist subagent (its built-in persona) to produce a step. */
async function runRole(org: Organization, role: Role, prompt: string, gen = generation.work): Promise<string> {
  const sub = subagentForRole(role);
  return systemReply(org, prompt, { persona: sub.persona, gen, withTools: role === "researcher" });
}

/**
 * Advance a deliverable by one step and re-enqueue until terminal. Safe to call
 * repeatedly and after a restart.
 */
export async function advanceDeliverable(deliverableId: string): Promise<void> {
  const d = await db.query.deliverables.findFirst({ where: eq(deliverables.id, deliverableId) });
  if (!d || d.status === "completed" || d.status === "failed" || d.status === "cancelled") return;
  const project = await db.query.projects.findFirst({ where: eq(projects.id, d.projectId) });
  if (!project) return;
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, d.organizationId) });
  if (!org) return;

  // The project's objective + scope (from its charter) grounds every step, so a
  // deliverable is generated from the prompt and scope even before sources pile
  // up, and stays on-target and in-scope.
  const scope = scopeBlock(parseCharter(project.charter), project.description);

  let terminal = false;

  if (d.status === "planning") {
    await planOutline(d, project, org, scope);
  } else if (d.status === "producing" || d.status === "revising") {
    terminal = await produceStep(d, project, org, scope);
  } else if (d.status === "reviewing") {
    terminal = await reviewStep(d, project, org, scope);
  }

  if (!terminal) enqueueDeliverable(deliverableId);
}

async function planOutline(d: Deliverable, project: { id: string; title: string; description: string | null; organizationId: string }, org: Organization, scope: string): Promise<void> {
  const context = await retrieveProjectContext(project, `${d.title}\n${d.brief ?? ""}`);
  const text = await runRole(
    org,
    "planner",
    [
      `Plan the outline for a ${d.kind} titled "${d.title}".`,
      d.brief ? `Brief: ${d.brief}` : "",
      scope ? `\n${scope}\n` : "",
      outlineGuidance(d.kind),
      context ? `\nProject knowledge to build on:\n${context}\n` : "",
      `Produce up to ${Math.min(12, limits.maxStageTasks + 4)} sections, each with a one-line brief of what it must cover. No overlap; complete coverage of the objective; nothing out of scope.`,
      'Respond with JSON only: {"sections":[{"heading":"...","brief":"..."}]}',
    ]
      .filter(Boolean)
      .join("\n"),
    generation.plan
  );
  const parsed = outlineSchema.safeParse(extractJson(text));
  const sections = parsed.success ? parsed.data.sections : [{ heading: d.title, brief: d.brief ?? d.title }];

  await db.insert(deliverableSections).values(
    sections.map((s, i) => ({ deliverableId: d.id, orderIndex: i, heading: s.heading, brief: s.brief, role: "writer", status: "planned" as const }))
  );
  await db.update(deliverables).set({ status: "producing", updatedAt: new Date() }).where(eq(deliverables.id, d.id));
  await dEvent(d.id, "outline_created", `Planned outline: ${sections.length} sections`);
  await recordProjectEvent(project.id, "deliverable_created", `Started deliverable "${d.title}"`, { type: "deliverable", id: d.id });
}

/** Draft/redraft the next unwritten section; when all are drafted, move to review. */
async function produceStep(d: Deliverable, project: { id: string; organizationId: string; title: string; description: string | null }, org: Organization, scope: string): Promise<boolean> {
  const sections = await db.query.deliverableSections.findMany({
    where: eq(deliverableSections.deliverableId, d.id),
    orderBy: asc(deliverableSections.orderIndex),
  });
  const next = sections.find((s) => s.status === "planned" || s.status === "revising");
  if (!next) {
    await db.update(deliverables).set({ status: "reviewing", updatedAt: new Date() }).where(eq(deliverables.id, d.id));
    return false;
  }

  const others = sections.filter((s) => s.id !== next.id).map((s) => `- ${s.heading}: ${s.brief ?? ""}`).join("\n");
  const context = await retrieveProjectContext({ id: project.id, organizationId: project.organizationId }, `${next.heading}\n${next.brief ?? ""}`);
  const issues = (next.evaluation as SectionIssue[]) ?? [];
  const isRevision = next.status === "revising";

  const role: Role = isRevision ? "editor" : "writer";
  const content = await runRole(
    org,
    role,
    [
      `${isRevision ? "Revise" : "Write"} the section "${next.heading}" of the ${d.kind} "${d.title}".`,
      next.brief ? `This section must cover: ${next.brief}` : "",
      scope ? `\n${scope}\nWrite for the stated audience and stay strictly within scope.\n` : "",
      `Other sections (for coherence, don't duplicate them):\n${others || "(none)"}`,
      context ? `\nEvidence from the project's knowledge:\n${context}\n` : "",
      isRevision && issues.length ? `Address these issues from review:\n${issues.map((i) => `- (${i.severity}) ${i.kind}: ${i.detail}`).join("\n")}` : "",
      sectionGuidance(d.kind),
    ]
      .filter(Boolean)
      .join("\n"),
    generation.work
  );

  await db
    .update(deliverableSections)
    .set({ content: content.trim(), status: "drafted", revision: next.revision + (isRevision ? 1 : 0), updatedAt: new Date() })
    .where(eq(deliverableSections.id, next.id));
  await dEvent(d.id, isRevision ? "section_revised" : "section_drafted", `${isRevision ? "Revised" : "Drafted"}: ${next.heading}`, next.id, role);
  return false;
}

/** Critique the next un-reviewed section; when all reviewed, run the quality gate. */
async function reviewStep(d: Deliverable, project: { id: string; title: string }, org: Organization, scope: string): Promise<boolean> {
  const sections = await db.query.deliverableSections.findMany({
    where: eq(deliverableSections.deliverableId, d.id),
    orderBy: asc(deliverableSections.orderIndex),
  });
  const next = sections.find((s) => s.status === "drafted");
  if (next) {
    const others = sections.filter((s) => s.id !== next.id).map((s) => `- ${s.heading}`).join("\n");
    const text = await runRole(
      org,
      "critic",
      [
        `Critically review this section of the ${d.kind} "${d.title}" for logical consistency, unsupported claims, weak arguments, inconsistent terminology, weak transitions, deviation from the objective, and anything out of scope or off-audience.`,
        scope ? `\n${scope}\n` : "",
        `Section "${next.heading}" — should cover: ${next.brief ?? ""}`,
        `Other sections: ${others || "(none)"}`,
        "",
        next.content ?? "(empty)",
        "",
        'List concrete issues. Respond with JSON only: {"issues":[{"kind":"...","detail":"...","severity":"minor|major|blocking"}]}. Empty issues if the section is solid.',
      ].join("\n"),
      generation.extract
    );
    const parsed = critiqueSchema.safeParse(extractJson(text));
    const issues = parsed.success ? parsed.data.issues : [];
    await db.update(deliverableSections).set({ evaluation: issues, status: "reviewing", updatedAt: new Date() }).where(eq(deliverableSections.id, next.id));
    await dEvent(d.id, "critique", `Reviewed "${next.heading}": ${issues.length} issue(s)`, next.id, "critic");
    return false;
  }

  // All sections critiqued this round → cross-section gap analysis, then gate.
  await gapAnalysis(d, org, sections);
  const reviewed = await db.query.deliverableSections.findMany({ where: eq(deliverableSections.deliverableId, d.id) });
  const config = resolveQualityConfig(d.qualityConfig);
  const gate = evaluateQualityGates(
    reviewed.map((s) => ({ id: s.id, issues: (s.evaluation as SectionIssue[]) ?? [] })),
    d.iteration,
    config
  );
  await dEvent(d.id, "quality_gate", gate.passed ? "Quality gate passed" : gate.forced ? "Iteration cap reached — finalizing" : `Revising ${gate.sectionsToRevise.length} section(s)`);

  if (gate.passed || gate.forced) {
    for (const s of reviewed) {
      if (s.status !== "dropped") await db.update(deliverableSections).set({ status: "approved" }).where(eq(deliverableSections.id, s.id));
    }
    await assemble(d, project, org);
    return true;
  }

  // Send failing sections back for another revision round.
  for (const s of reviewed) {
    if (gate.sectionsToRevise.includes(s.id)) await db.update(deliverableSections).set({ status: "revising" }).where(eq(deliverableSections.id, s.id));
    else if (s.status === "reviewing") await db.update(deliverableSections).set({ status: "approved" }).where(eq(deliverableSections.id, s.id));
  }
  await db.update(deliverables).set({ status: "producing", iteration: d.iteration + 1, updatedAt: new Date() }).where(eq(deliverables.id, d.id));
  return false;
}

/** One cross-section pass (continuity + gaps) that may attach issues or add sections. */
async function gapAnalysis(d: Deliverable, org: Organization, sections: DeliverableSection[]): Promise<void> {
  const outline = sections.map((s) => `- ${s.heading}: ${s.brief ?? ""}`).join("\n");
  const text = await runRole(
    org,
    "gap_analysis",
    [
      `Review the whole outline of the ${d.kind} "${d.title}" against its goal${d.brief ? ` (${d.brief})` : ""}. Find missing topics, redundant/overlapping sections, and structural gaps.`,
      `Outline:\n${outline}`,
      'Respond with JSON only: {"issues":[{"kind":"...","detail":"...","severity":"minor|major|blocking"}], "addSections":[{"heading":"...","brief":"..."}]}. Use addSections only for genuinely missing coverage; keep it empty otherwise.',
    ].join("\n"),
    generation.extract
  );
  const parsed = gapSchema.safeParse(extractJson(text));
  if (!parsed.success) return;

  // Add newly-identified missing sections (living outline evolves).
  const maxOrder = Math.max(-1, ...sections.map((s) => s.orderIndex));
  for (const [i, s] of (parsed.data.addSections ?? []).entries()) {
    await db.insert(deliverableSections).values({ deliverableId: d.id, orderIndex: maxOrder + 1 + i, heading: s.heading, brief: s.brief, role: "writer", status: "planned" });
    await dEvent(d.id, "outline_changed", `Added missing section: ${s.heading}`);
  }
  // Attach any structural issues to the first section so the gate can react.
  const gapIssues = parsed.data.issues ?? [];
  if (gapIssues.length && sections[0]) {
    const existing = (sections[0].evaluation as SectionIssue[]) ?? [];
    await db.update(deliverableSections).set({ evaluation: [...existing, ...gapIssues] }).where(eq(deliverableSections.id, sections[0].id));
    await dEvent(d.id, "gap_found", `${gapIssues.length} structural issue(s)`);
  }
  // If we added sections, they still need drafting → bounce back to producing.
  if ((parsed.data.addSections ?? []).length > 0) {
    await db.update(deliverables).set({ status: "producing", updatedAt: new Date() }).where(eq(deliverables.id, d.id));
  }
}

/** Assemble approved sections into the final document and close the loop. */
async function assemble(d: Deliverable, project: { id: string; title: string }, org: Organization): Promise<void> {
  const sections = await db.query.deliverableSections.findMany({
    where: and(eq(deliverableSections.deliverableId, d.id), eq(deliverableSections.status, "approved")),
    orderBy: asc(deliverableSections.orderIndex),
  });
  const body = sections.map((s) => `## ${s.heading}\n\n${(s.content ?? "").trim()}`).join("\n\n");
  const content = `# ${d.title}\n\n${body}`;

  // Structured kinds (presentation/workbook) also assemble a typed spec that the
  // native renderer turns into a real .pptx/.xlsx.
  const kind = structuredKind(d.kind);
  let spec: DeckSpec | WorkbookSpec | null = null;
  if (kind === "presentation") {
    spec = { title: d.title, slides: sections.map((s) => slideFromMarkdown(s.heading, s.content ?? "")) };
  } else if (kind === "workbook") {
    spec = { title: d.title, sheets: sections.map((s) => sheetFromMarkdown(s.heading, s.content ?? "")) };
  }

  await db.update(deliverables).set({ status: "completed", content, spec, updatedAt: new Date() }).where(eq(deliverables.id, d.id));
  await dEvent(d.id, "assembled", `Assembled ${sections.length} sections into the final ${d.kind}`);
  await recordProjectEvent(project.id, "deliverable_completed", `Completed deliverable "${d.title}"`, { type: "deliverable", id: d.id });

  // Loop closure: fold the deliverable's insights back into the project's
  // knowledge so future work builds on it.
  await addSource({
    projectId: d.projectId,
    orgId: org.id,
    kind: "task_output",
    title: `Deliverable: ${d.title}`,
    content: content.slice(0, 12000),
  }).catch(() => {});
}
