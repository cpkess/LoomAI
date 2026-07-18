import { eq } from "drizzle-orm";
import { z } from "zod";

import { ACTION_TYPES } from "@/lib/company/actions";
import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  governance: z.partialRecord(z.enum(ACTION_TYPES), z.enum(["auto", "board"])).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "org_admin");
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

    const settings = { ...(ctx.org.settings as Record<string, unknown>) };
    if (parsed.data.governance) {
      settings.governance = {
        ...((settings.governance as Record<string, string>) ?? {}),
        ...parsed.data.governance,
      };
    }

    const [org] = await db
      .update(organizations)
      .set({
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        settings,
      })
      .where(eq(organizations.id, ctx.org.id))
      .returning();
    return Response.json({ organization: org });
  } catch (err) {
    return errorResponse(err);
  }
}
