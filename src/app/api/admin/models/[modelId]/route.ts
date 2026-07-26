import { eq } from "drizzle-orm";
import { z } from "zod";

import { errorResponse, requirePlatformAdmin } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { aiModels } from "@/lib/db/schema";

const updateSchema = z.object({ enabled: z.boolean() });

export async function PATCH(req: Request, { params }: { params: Promise<{ modelId: string }> }) {
  try {
    await requirePlatformAdmin();
    const { modelId } = await params;
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });
    const [model] = await db
      .update(aiModels)
      .set({ enabled: parsed.data.enabled })
      .where(eq(aiModels.id, modelId))
      .returning();
    if (!model) return Response.json({ error: "Model not found" }, { status: 404 });
    return Response.json({ model });
  } catch (err) {
    return errorResponse(err);
  }
}
