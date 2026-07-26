import { eq } from "drizzle-orm";
import { z } from "zod";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  autoKnowledge: z.boolean().optional(),
  webResearch: z.boolean().optional(),
  defaultModelId: z.string().uuid().nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "org_admin");
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

    const settings = { ...(ctx.org.settings as Record<string, unknown>) };
    if (parsed.data.autoKnowledge !== undefined) settings.autoKnowledge = parsed.data.autoKnowledge;
    if (parsed.data.webResearch !== undefined) settings.webResearch = parsed.data.webResearch;
    if (parsed.data.defaultModelId !== undefined) settings.defaultModelId = parsed.data.defaultModelId ?? undefined;

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
