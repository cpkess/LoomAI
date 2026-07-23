import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { ownedProject } from "@/lib/projects/chat";
import { latestSolution, problemSchema, solutionModelSchema, startSolution, verificationSchema } from "@/lib/projects/solution";

// GET → the project's latest Solution (status + diagnosed problem + the single
// answer + its verification). POST → kick off a fresh solve from the current
// brief, scope, and knowledge.
export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    if (!(await ownedProject(ctx.org.id, projectId))) return Response.json({ error: "Project not found" }, { status: 404 });

    const s = await latestSolution(projectId);
    if (!s) return Response.json({ solution: null });

    return Response.json({
      solution: {
        id: s.id,
        status: s.status,
        iteration: s.iteration,
        error: s.error,
        problem: s.problem ? problemSchema.safeParse(s.problem).data ?? null : null,
        model: s.model ? solutionModelSchema.safeParse(s.model).data ?? null : null,
        verification: s.verification ? verificationSchema.safeParse(s.verification).data ?? null : null,
        updatedAt: s.updatedAt,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(_req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    if (!(await ownedProject(ctx.org.id, projectId))) return Response.json({ error: "Project not found" }, { status: 404 });

    const id = await startSolution(projectId, ctx.org.id, ctx.user.id);
    return Response.json({ solution: { id } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
