import { eq } from "drizzle-orm";
import { z } from "zod";

import { errorResponse, requirePlatformAdmin } from "@/lib/auth/authorize";
import { encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { aiProviders } from "@/lib/db/schema";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    await requirePlatformAdmin();
    const { providerId } = await params;
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid input" }, { status: 400 });
    }
    const { apiKey, ...rest } = parsed.data;
    const [provider] = await db
      .update(aiProviders)
      .set({ ...rest, ...(apiKey !== undefined ? { apiKeyEncrypted: apiKey ? encryptSecret(apiKey) : null } : {}) })
      .where(eq(aiProviders.id, providerId))
      .returning();
    if (!provider) return Response.json({ error: "Provider not found" }, { status: 404 });
    return Response.json({ provider: { ...provider, apiKeyEncrypted: undefined } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    await requirePlatformAdmin();
    const { providerId } = await params;
    await db.delete(aiProviders).where(eq(aiProviders.id, providerId));
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
