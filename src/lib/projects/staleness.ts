import type { ProjectKnowledgeItem } from "@/lib/db/schema";

// Time-awareness for living projects: knowledge expires. Each knowledge type
// has a review interval (TTL); an item not reconfirmed within its interval is
// considered stale and should be revisited. Pure and deterministic so it can be
// computed on demand (when a project is opened) without a scheduler.

const DAY = 24 * 60 * 60 * 1000;

function ttlDays(envKey: string, fallback: number): number {
  const v = Number(process.env[envKey]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Review interval per knowledge type, in milliseconds. Env-overridable. */
export const TTL_BY_TYPE: Record<ProjectKnowledgeItem["type"], number> = {
  risk: ttlDays("LOOMAI_TTL_RISK_DAYS", 30) * DAY,
  question: ttlDays("LOOMAI_TTL_QUESTION_DAYS", 45) * DAY,
  assumption: ttlDays("LOOMAI_TTL_ASSUMPTION_DAYS", 60) * DAY,
  claim: ttlDays("LOOMAI_TTL_CLAIM_DAYS", 90) * DAY,
  insight: ttlDays("LOOMAI_TTL_INSIGHT_DAYS", 120) * DAY,
  fact: ttlDays("LOOMAI_TTL_FACT_DAYS", 180) * DAY,
  decision: ttlDays("LOOMAI_TTL_DECISION_DAYS", 180) * DAY,
};

type StaleCandidate = Pick<ProjectKnowledgeItem, "id" | "type" | "status" | "reviewedAt">;

/** Is a single item stale as of `now`? Only `active`/`challenged` items go stale. */
export function isStale(item: StaleCandidate, now: Date = new Date()): boolean {
  if (item.status !== "active" && item.status !== "challenged") return false;
  const age = now.getTime() - new Date(item.reviewedAt).getTime();
  return age > TTL_BY_TYPE[item.type];
}

/** Ids of items that have become stale as of `now`. */
export function staleItemIds(items: StaleCandidate[], now: Date = new Date()): string[] {
  return items.filter((i) => isStale(i, now)).map((i) => i.id);
}
