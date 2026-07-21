import { and, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { generation } from "@/lib/ai/generation";
import { db } from "@/lib/db";
import {
  documents,
  orgActions,
  organizations,
  projects,
  type OrgAction,
  type Organization,
} from "@/lib/db/schema";
import { allOrgCollectionIds } from "@/lib/rag/knowledge";

import { getChiefAgent } from "./chief";
import { agentReply, createAndEnqueueTask, enqueueProject } from "./engine";
import { extractJson } from "./json";

// The company recommends its own next moves. Once it has accumulated enough
// knowledge, the CEO agent — grounded in the org-wide knowledge base — proposes
// the highest-value next projects and deliverables. Each proposal is filed as a
// pending Board proposal (an `org_actions` row), so it flows through the exact
// same approve/reject + nav-badge machinery as governance actions. Approving a
// recommendation creates the project/task and runs it autonomously.

export const RECOMMENDATION_TYPES = ["recommend_project", "recommend_deliverable"] as const;
export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

/** Is this org_action a recommendation (vs. a governance action)? */
export function isRecommendation(type: string): boolean {
  return type.startsWith("recommend_");
}

/** Normalize a title for dedup comparisons. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function minDocs(): number {
  const v = Number(process.env.LOOMAI_RECOMMEND_MIN_DOCS);
  return Number.isFinite(v) && v >= 0 ? v : 5;
}

// Don't let recommendations pile up unreviewed.
const MAX_PENDING = 5;

/** Count of ready (indexed) documents across the whole org knowledge base. */
async function readyDocCount(orgId: string): Promise<number> {
  const collectionIds = await allOrgCollectionIds(orgId);
  if (collectionIds.length === 0) return 0;
  const [row] = await db
    .select({ value: count() })
    .from(documents)
    .where(and(inArray(documents.collectionId, collectionIds), eq(documents.status, "ready")));
  return row?.value ?? 0;
}

/**
 * The "learns enough" gate: recommendations unlock once the company has both a
 * chief (CEO) to author them and a substantial knowledge base to draw on.
 */
export async function hasLearnedEnough(orgId: string): Promise<boolean> {
  const chief = await getChiefAgent(orgId);
  if (!chief) return false;
  return (await readyDocCount(orgId)) >= minDocs();
}

const recommendationSchema = z.object({
  recommendations: z
    .array(
      z.object({
        kind: z.enum(["project", "deliverable"]),
        title: z.string().min(1).max(200),
        description: z.string().min(1).max(4000),
        rationale: z.string().max(2000).optional(),
      })
    )
    .max(8),
});

export interface GenerateResult {
  created: number;
  learnedEnough: boolean;
}

/**
 * Generate and file new project/deliverable recommendations as pending Board
 * proposals. Gated by `hasLearnedEnough`, throttled by the pending cap, and
 * deduped against existing pending recommendations and recent projects.
 */
export async function generateRecommendations(orgId: string, options: { max?: number } = {}): Promise<GenerateResult> {
  const max = options.max ?? 4;
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
  if (!org) return { created: 0, learnedEnough: false };

  const chief = await getChiefAgent(orgId);
  if (!chief) return { created: 0, learnedEnough: false };
  if (!(await hasLearnedEnough(orgId))) return { created: 0, learnedEnough: false };

  // Throttle: skip if the Board already has a backlog of suggestions.
  const [pending] = await db
    .select({ value: count() })
    .from(orgActions)
    .where(
      and(
        eq(orgActions.organizationId, orgId),
        eq(orgActions.status, "pending_approval"),
        inArray(orgActions.type, RECOMMENDATION_TYPES as unknown as string[])
      )
    );
  if ((pending?.value ?? 0) >= MAX_PENDING) return { created: 0, learnedEnough: true };

  const recentProjects = await db.query.projects.findMany({
    where: eq(projects.organizationId, orgId),
    orderBy: desc(projects.createdAt),
    limit: 8,
  });

  const recentBlock = recentProjects.length
    ? recentProjects
        .map((p) => `- ${p.title} (${p.status})${p.summary ? `: ${p.summary.slice(0, 300)}` : ""}`)
        .join("\n")
    : "(no projects yet)";

  const prompt = [
    `You are ${chief.name}, the CEO of ${org.name}. Using everything the company knows (its knowledge base is available to you) and the work done so far, propose the most valuable next initiatives.`,
    "",
    "Recent projects:",
    recentBlock,
    "",
    `Propose up to ${max} concrete, high-impact recommendations. Use kind "project" for multi-step initiatives and kind "deliverable" for a single focused artifact (a report, plan, analysis). Each needs a short rationale grounded in what the company knows or needs.`,
    "Do not repeat recent projects. Prefer new, specific, actionable ideas.",
    'Respond with JSON only: {"recommendations":[{"kind":"project|deliverable","title":"...","description":"...","rationale":"..."}]}',
  ].join("\n");

  let text: string;
  try {
    text = await agentReply(chief, org, prompt, { gen: generation.plan });
  } catch (err) {
    console.error("recommendation generation failed", err);
    return { created: 0, learnedEnough: true };
  }

  const parsed = recommendationSchema.safeParse(extractJson(text));
  if (!parsed.success || parsed.data.recommendations.length === 0) return { created: 0, learnedEnough: true };

  // Dedup against existing pending recommendations and recent project titles.
  const existing = await db.query.orgActions.findMany({
    where: and(
      eq(orgActions.organizationId, orgId),
      eq(orgActions.status, "pending_approval"),
      inArray(orgActions.type, RECOMMENDATION_TYPES as unknown as string[])
    ),
  });
  const seen = new Set<string>([
    ...existing.map((a) => normalizeTitle(((a.payload as { title?: string })?.title) ?? a.summary)),
    ...recentProjects.map((p) => normalizeTitle(p.title)),
  ]);

  let created = 0;
  for (const rec of parsed.data.recommendations) {
    if (created >= max || (pending?.value ?? 0) + created >= MAX_PENDING) break;
    const key = normalizeTitle(rec.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const type: RecommendationType = rec.kind === "project" ? "recommend_project" : "recommend_deliverable";
    await db.insert(orgActions).values({
      organizationId: orgId,
      type,
      payload: { title: rec.title, description: rec.description, rationale: rec.rationale ?? null },
      status: "pending_approval",
      summary: `💡 Recommended ${rec.kind}: ${rec.title}`,
      proposedByAgentId: chief.id,
    });
    created++;
  }

  return { created, learnedEnough: true };
}

/**
 * Accept a recommendation: create the project (or single-task deliverable) and
 * run it autonomously, then mark the proposal executed. Called from the Board
 * decide route for recommendation-typed proposals.
 */
export async function acceptRecommendation(
  org: Organization,
  action: OrgAction,
  deciderUserId: string
): Promise<OrgAction> {
  if (action.status !== "pending_approval") throw new Error("This recommendation has already been decided");
  const payload = (action.payload ?? {}) as { title?: string; description?: string };
  const title = payload.title?.trim();
  if (!title) throw new Error("Recommendation is missing a title");

  const chief = await getChiefAgent(org.id);
  let result: string;

  if (action.type === "recommend_project") {
    const [project] = await db
      .insert(projects)
      .values({
        organizationId: org.id,
        title,
        description: payload.description ?? null,
        status: "planning",
        managerAgentId: chief?.id ?? null,
        createdByUserId: deciderUserId,
      })
      .returning();
    enqueueProject(project.id);
    result = `Project "${title}" created — the manager is planning it into milestones.`;
  } else {
    if (!chief) throw new Error("Hire an AI employee before accepting deliverable recommendations");
    await createAndEnqueueTask({
      orgId: org.id,
      title,
      description: payload.description ?? null,
      coordinatorAgentId: chief.id,
      createdByUserId: deciderUserId,
    });
    result = `Deliverable "${title}" assigned to ${chief.name}.`;
  }

  const [updated] = await db
    .update(orgActions)
    .set({ status: "executed", decidedByUserId: deciderUserId, decidedAt: new Date(), result })
    .where(eq(orgActions.id, action.id))
    .returning();
  return updated;
}
