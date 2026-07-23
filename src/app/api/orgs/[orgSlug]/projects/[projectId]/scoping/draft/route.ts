import { eq } from "drizzle-orm";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { ownedProject } from "@/lib/projects/chat";
import { draftCharter, ensureScopingConversation, saveCharter } from "@/lib/projects/scoping";

// Force a re-draft of the work plan from the current brief + conversation.
export async function POST(_req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const project = await ownedProject(ctx.org.id, projectId);
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, ctx.org.id) });
    if (!org) return Response.json({ error: "Organization not found" }, { status: 404 });

    const conversationId = await ensureScopingConversation(projectId, ctx.user.id);
    const charter = await draftCharter(project, org, conversationId);
    await saveCharter(projectId, charter);
    return Response.json({ charter });
  } catch (err) {
    return errorResponse(err);
  }
}
