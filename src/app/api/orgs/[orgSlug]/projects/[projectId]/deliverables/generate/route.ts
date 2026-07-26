import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { ownedProject } from "@/lib/projects/chat";
import { generatePlannedDeliverables } from "@/lib/projects/deliverables";

// One-click: generate the deliverables the project's work plan calls for
// (falls back to a single scope-grounded report when the plan names none).
export async function POST(_req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    if (!(await ownedProject(ctx.org.id, projectId))) return Response.json({ error: "Project not found" }, { status: 404 });

    const created = await generatePlannedDeliverables({ projectId, orgId: ctx.org.id, createdByUserId: ctx.user.id });
    return Response.json({ created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
