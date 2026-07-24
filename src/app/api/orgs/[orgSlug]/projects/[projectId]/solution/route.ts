import { desc, eq } from "drizzle-orm";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { solutions } from "@/lib/db/schema";
import { ownedProject } from "@/lib/projects/chat";
import {
  continueSolution,
  evidenceSchema,
  latestSolution,
  problemSchema,
  researchRecordSchema,
  solutionModelSchema,
  startSolution,
  verificationSchema,
} from "@/lib/projects/solution";

// GET → a project's Solution (the latest round by default, or a specific one
// via ?solutionId=), plus the list of rounds so earlier answers stay reachable.
// POST → start a round: a fresh solve, or — with `direction` — a follow-up that
// carries the previous round's evidence forward and pursues the steer.
export async function GET(req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    if (!(await ownedProject(ctx.org.id, projectId))) return Response.json({ error: "Project not found" }, { status: 404 });

    const requestedId = new URL(req.url).searchParams.get("solutionId");
    const s = requestedId
      ? (await db.query.solutions.findFirst({ where: eq(solutions.id, requestedId) })) ?? null
      : await latestSolution(projectId);

    // Never serve a solution belonging to another project or tenant.
    if (s && (s.projectId !== projectId || s.organizationId !== ctx.org.id)) {
      return Response.json({ error: "Solution not found" }, { status: 404 });
    }
    if (!s) return Response.json({ solution: null, rounds: [] });

    const all = await db.query.solutions.findMany({
      where: eq(solutions.projectId, projectId),
      orderBy: desc(solutions.round),
      columns: { id: true, round: true, direction: true, status: true, createdAt: true, verification: true },
    });

    return Response.json({
      solution: {
        id: s.id,
        status: s.status,
        iteration: s.iteration,
        round: s.round,
        direction: s.direction,
        error: s.error,
        researchMode: s.researchMode,
        problem: s.problem ? problemSchema.safeParse(s.problem).data ?? null : null,
        model: s.model ? solutionModelSchema.safeParse(s.model).data ?? null : null,
        evidence: s.evidence ? evidenceSchema.safeParse(s.evidence).data ?? [] : [],
        research: s.research ? researchRecordSchema.safeParse(s.research).data ?? null : null,
        verification: s.verification ? verificationSchema.safeParse(s.verification).data ?? null : null,
        updatedAt: s.updatedAt,
      },
      rounds: all.map((r) => ({
        id: r.id,
        round: r.round,
        direction: r.direction,
        status: r.status,
        score: r.verification ? verificationSchema.safeParse(r.verification).data?.score ?? null : null,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    if (!(await ownedProject(ctx.org.id, projectId))) return Response.json({ error: "Project not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const research = body?.research !== false; // default on
    const direction = typeof body?.direction === "string" ? body.direction.trim() : "";
    if (direction.length > 2000) return Response.json({ error: "Direction is too long" }, { status: 400 });

    const id = direction
      ? await continueSolution(projectId, ctx.org.id, ctx.user.id, direction, research)
      : await startSolution(projectId, ctx.org.id, ctx.user.id, research);
    return Response.json({ solution: { id } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
