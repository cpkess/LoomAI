import { eq } from "drizzle-orm";

import { errorResponse, requirePlatformAdmin } from "@/lib/auth/authorize";
import { getPlugin, toInstance } from "@/lib/ai/registry";
import { db } from "@/lib/db";
import { aiProviders } from "@/lib/db/schema";

export async function POST(_req: Request, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    await requirePlatformAdmin();
    const { providerId } = await params;
    const provider = await db.query.aiProviders.findFirst({ where: eq(aiProviders.id, providerId) });
    if (!provider) return Response.json({ error: "Provider not found" }, { status: 404 });
    const plugin = getPlugin(provider.type);
    const health = await plugin.healthCheck(toInstance(provider));
    return Response.json({ health });
  } catch (err) {
    return errorResponse(err);
  }
}
