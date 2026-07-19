import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { boardEmails } from "@/lib/db/schema";

const schema = z.object({ read: z.boolean() });

export async function PATCH(req: Request, { params }: { params: Promise<{ orgSlug: string; emailId: string }> }) {
  try {
    const { orgSlug, emailId } = await params;
    const ctx = await requireOrg(orgSlug, "member");
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

    const [updated] = await db
      .update(boardEmails)
      .set({ readAt: parsed.data.read ? new Date() : null })
      .where(and(eq(boardEmails.id, emailId), eq(boardEmails.organizationId, ctx.org.id)))
      .returning();
    if (!updated) return Response.json({ error: "Email not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
