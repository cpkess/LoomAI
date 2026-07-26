import { desc, eq } from "drizzle-orm";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { ownedProject } from "@/lib/projects/chat";

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) {
  try {
    const { orgSlug, projectId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    if (!(await ownedProject(ctx.org.id, projectId))) return Response.json({ error: "Project not found" }, { status: 404 });

    const rows = await db.query.conversations.findMany({
      where: eq(conversations.projectId, projectId),
      orderBy: desc(conversations.updatedAt),
    });
    return Response.json({
      conversations: rows
        .filter((c) => c.userId === ctx.user.id)
        .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt })),
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

    const [c] = await db
      .insert(conversations)
      .values({ projectId, userId: ctx.user.id, title: "New conversation" })
      .returning();
    return Response.json({ conversation: { id: c.id, title: c.title } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
