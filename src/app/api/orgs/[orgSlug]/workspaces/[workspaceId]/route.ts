import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { aiModels, workspaces } from "@/lib/db/schema";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullish(),
  defaultModelId: z.string().uuid().nullish(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ orgSlug: string; workspaceId: string }> }) {
  try {
    const { orgSlug, workspaceId } = await params;
    const ctx = await requireOrg(orgSlug, "org_admin");
    const workspace = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, ctx.org.id)),
    });
    if (!workspace) return Response.json({ error: "Department not found" }, { status: 404 });

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });
    const data = parsed.data;

    if (data.defaultModelId) {
      const model = await db.query.aiModels.findFirst({ where: eq(aiModels.id, data.defaultModelId) });
      if (!model) return Response.json({ error: "Model not found" }, { status: 400 });
    }

    const settings = { ...(workspace.settings as Record<string, unknown>) };
    if (data.defaultModelId !== undefined) {
      if (data.defaultModelId === null) delete settings.defaultModelId;
      else settings.defaultModelId = data.defaultModelId;
    }

    const [updated] = await db
      .update(workspaces)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        settings,
      })
      .where(eq(workspaces.id, workspaceId))
      .returning();
    return Response.json({ workspace: updated });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ orgSlug: string; workspaceId: string }> }) {
  try {
    const { orgSlug, workspaceId } = await params;
    const ctx = await requireOrg(orgSlug, "org_admin");
    const deleted = await db
      .delete(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, ctx.org.id)))
      .returning();
    if (deleted.length === 0) return Response.json({ error: "Department not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
