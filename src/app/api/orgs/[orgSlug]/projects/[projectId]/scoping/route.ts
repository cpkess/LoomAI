import { and, asc, eq } from "drizzle-orm";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { messages, organizations } from "@/lib/db/schema";
import { ownedProject } from "@/lib/projects/chat";
import { draftCharter, ensureScopingConversation, parseCharter, saveCharter } from "@/lib/projects/scoping";

// The scoping state: the current work plan (charter), the scoping conversation,
// and its messages. On first open with no charter yet, an initial plan is
// drafted from the brief so a single prompt already yields a full plan.
export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const project = await ownedProject(ctx.org.id, projectId);
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    const conversationId = await ensureScopingConversation(projectId, ctx.user.id);

    let charter = parseCharter(project.charter);
    if (!charter) {
      const org = await db.query.organizations.findFirst({ where: eq(organizations.id, ctx.org.id) });
      if (org) {
        charter = await draftCharter(project, org, conversationId);
        await saveCharter(projectId, charter);
      }
    }

    const rows = await db.query.messages.findMany({
      where: and(eq(messages.conversationId, conversationId)),
      orderBy: asc(messages.createdAt),
    });

    return Response.json({
      status: project.status,
      conversationId,
      charter,
      messages: rows.filter((m) => m.role !== "system").map((m) => ({ id: m.id, role: m.role, content: m.content })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
