import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { promptVersions, prompts } from "@/lib/db/schema";
import { extractVariables } from "@/lib/prompts/interpolate";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullish(),
  category: z.string().min(1).max(60).optional(),
  content: z.string().min(1).max(20000).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ orgSlug: string; promptId: string }> }) {
  try {
    const { orgSlug, promptId } = await params;
    const ctx = await requireOrg(orgSlug, "workspace_manager");
    const existing = await db.query.prompts.findFirst({
      where: and(eq(prompts.id, promptId), eq(prompts.organizationId, ctx.org.id)),
    });
    if (!existing) return Response.json({ error: "Prompt not found" }, { status: 404 });

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });
    const data = parsed.data;

    const contentChanged = data.content !== undefined && data.content !== existing.content;
    if (contentChanged) {
      // Archive the previous content before bumping the version.
      await db.insert(promptVersions).values({
        promptId: existing.id,
        version: existing.version,
        content: existing.content,
      });
    }

    const [prompt] = await db
      .update(prompts)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(contentChanged
          ? { content: data.content, variables: extractVariables(data.content!), version: existing.version + 1 }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(prompts.id, promptId))
      .returning();
    return Response.json({ prompt });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ orgSlug: string; promptId: string }> }) {
  try {
    const { orgSlug, promptId } = await params;
    const ctx = await requireOrg(orgSlug, "workspace_manager");
    const deleted = await db
      .delete(prompts)
      .where(and(eq(prompts.id, promptId), eq(prompts.organizationId, ctx.org.id)))
      .returning();
    if (deleted.length === 0) return Response.json({ error: "Prompt not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
