import { and, desc, eq, gt } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  deliverables,
  projectEvents,
  projectKnowledgeItems,
  projectSources,
  projectViews,
  projects,
} from "@/lib/db/schema";

import { setItemStatus } from "./knowledge";
import { staleItemIds } from "./staleness";

// The resume briefing: returning to a project should feel like resuming with a
// collaborator who remembers everything. It reports what changed since your
// last visit, freshly-detected stale knowledge, open questions, unresolved
// contradictions, risks, and the current recommended next steps. Staleness is
// computed here (on open) — no scheduler needed.

export interface Briefing {
  projectId: string;
  since: string | null;
  nextSteps: string | null;
  lastAnalyzedAt: string | null;
  counts: { items: number; sources: number; deliverables: number };
  changedSince: { events: number; label: string };
  openQuestions: { id: string; content: string }[];
  challenged: { id: string; content: string }[];
  risks: { id: string; content: string }[];
  stale: { id: string; type: string; content: string }[];
  timeline: { id: string; kind: string; summary: string; createdAt: string }[];
}

export async function buildBriefing(projectId: string, userId: string): Promise<Briefing | null> {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project) return null;

  const view = await db.query.projectViews.findFirst({
    where: and(eq(projectViews.projectId, projectId), eq(projectViews.userId, userId)),
  });
  const since = view?.lastViewedAt ?? null;

  const items = await db.query.projectKnowledgeItems.findMany({
    where: eq(projectKnowledgeItems.projectId, projectId),
  });

  // Detect + persist newly stale knowledge (on-open time awareness).
  const now = new Date();
  const nowStale = new Set(staleItemIds(items, now));
  for (const item of items) {
    if (nowStale.has(item.id) && item.status !== "stale") {
      await setItemStatus(item, "stale", "stale_flagged", `Stale (needs review): ${item.content.slice(0, 120)}`);
      item.status = "stale";
    }
  }

  const active = items.filter((i) => i.status === "active");
  const [sourceCount, deliverableCount] = await Promise.all([
    db.$count(projectSources, eq(projectSources.projectId, projectId)),
    db.$count(deliverables, eq(deliverables.projectId, projectId)),
  ]);

  const recentEvents = await db.query.projectEvents.findMany({
    where: eq(projectEvents.projectId, projectId),
    orderBy: desc(projectEvents.createdAt),
    limit: 20,
  });
  const changedEvents = since
    ? await db.$count(projectEvents, and(eq(projectEvents.projectId, projectId), gt(projectEvents.createdAt, since)))
    : recentEvents.length;

  // Mark viewed now (upsert).
  if (view) {
    await db.update(projectViews).set({ lastViewedAt: now }).where(eq(projectViews.id, view.id));
  } else {
    await db.insert(projectViews).values({ projectId, userId, lastViewedAt: now });
  }

  return {
    projectId,
    since: since ? since.toISOString() : null,
    nextSteps: project.nextSteps,
    lastAnalyzedAt: project.lastAnalyzedAt ? project.lastAnalyzedAt.toISOString() : null,
    counts: { items: items.length, sources: sourceCount, deliverables: deliverableCount },
    changedSince: { events: changedEvents, label: since ? "since your last visit" : "so far" },
    openQuestions: active.filter((i) => i.type === "question").map((i) => ({ id: i.id, content: i.content })),
    challenged: items.filter((i) => i.status === "challenged").map((i) => ({ id: i.id, content: i.content })),
    risks: active.filter((i) => i.type === "risk").map((i) => ({ id: i.id, content: i.content })),
    stale: items.filter((i) => i.status === "stale").map((i) => ({ id: i.id, type: i.type, content: i.content })),
    timeline: recentEvents.map((e) => ({ id: e.id, kind: e.kind, summary: e.summary, createdAt: e.createdAt.toISOString() })),
  };
}
