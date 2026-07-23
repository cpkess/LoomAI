import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { ownedProject } from "@/lib/projects/chat";
import { charterSchema, finalizeScoping } from "@/lib/projects/scoping";

// Accept the (optionally user-edited) work plan: seed the knowledge graph,
// refresh next steps, and move the project from scoping to a live project.
export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    if (!(await ownedProject(ctx.org.id, projectId))) return Response.json({ error: "Project not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const parsed = charterSchema.safeParse(body.charter);
    if (!parsed.success) return Response.json({ error: "Invalid work plan" }, { status: 400 });

    const charter = await finalizeScoping(projectId, parsed.data, ctx.user.id);
    return Response.json({ charter });
  } catch (err) {
    return errorResponse(err);
  }
}
