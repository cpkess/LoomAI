import { eq } from "drizzle-orm";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { ownedProject } from "@/lib/projects/chat";
import { recordProjectEvent } from "@/lib/projects/knowledge";

// Re-open scoping on an existing project: back to "planning" so the plan can be
// revisited. Seeded knowledge stays; finalizing again refreshes it.
export async function POST(_req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    if (!(await ownedProject(ctx.org.id, projectId))) return Response.json({ error: "Project not found" }, { status: 404 });

    await db.update(projects).set({ status: "planning", updatedAt: new Date() }).where(eq(projects.id, projectId));
    await recordProjectEvent(projectId, "scoping_reopened", "Re-opened scoping to revise the work plan");
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
