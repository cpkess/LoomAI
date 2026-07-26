import { z } from "zod";

import { errorResponse, requirePlatformAdmin } from "@/lib/auth/authorize";
import { encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { aiProviders, providerType } from "@/lib/db/schema";

const createSchema = z.object({
  type: z.enum(providerType.enumValues),
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    await requirePlatformAdmin();
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const { type, name, baseUrl, apiKey } = parsed.data;
    const [provider] = await db
      .insert(aiProviders)
      .values({
        type,
        name,
        baseUrl,
        apiKeyEncrypted: apiKey ? encryptSecret(apiKey) : null,
      })
      .returning();
    return Response.json({ provider: { ...provider, apiKeyEncrypted: undefined } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
