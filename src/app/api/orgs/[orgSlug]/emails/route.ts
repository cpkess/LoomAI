import { desc, eq } from "drizzle-orm";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { boardEmails } from "@/lib/db/schema";

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const rows = await db.query.boardEmails.findMany({
      where: eq(boardEmails.organizationId, ctx.org.id),
      orderBy: desc(boardEmails.createdAt),
      limit: 100,
    });
    return Response.json({
      emails: rows.map((e) => ({
        id: e.id,
        taskId: e.taskId,
        fromName: e.fromName,
        subject: e.subject,
        body: e.body,
        outcome: e.outcome,
        read: e.readAt !== null,
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
