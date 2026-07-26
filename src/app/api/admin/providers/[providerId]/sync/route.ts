import { and, eq, inArray, notInArray } from "drizzle-orm";

import { errorResponse, requirePlatformAdmin } from "@/lib/auth/authorize";
import { getPlugin, toInstance } from "@/lib/ai/registry";
import { db } from "@/lib/db";
import { aiModels, aiProviders } from "@/lib/db/schema";

// Discover the models a provider currently serves and sync them into
// ai_models: new models are inserted (enabled), known models get their
// capabilities refreshed, vanished models are removed unless conversations
// could still reference them — they are disabled instead.
export async function POST(_req: Request, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    await requirePlatformAdmin();
    const { providerId } = await params;
    const provider = await db.query.aiProviders.findFirst({ where: eq(aiProviders.id, providerId) });
    if (!provider) return Response.json({ error: "Provider not found" }, { status: 404 });

    const plugin = getPlugin(provider.type);
    const discovered = await plugin.listModels(toInstance(provider));
    const discoveredIds = discovered.map((m) => m.modelId);

    const existing = await db.query.aiModels.findMany({ where: eq(aiModels.providerId, provider.id) });
    const existingById = new Map(existing.map((m) => [m.modelId, m]));

    for (const model of discovered) {
      const row = existingById.get(model.modelId);
      if (row) {
        await db
          .update(aiModels)
          .set({
            capabilities: model.capabilities,
            contextWindow: model.contextWindow ?? row.contextWindow,
            displayName: model.displayName ?? row.displayName,
            kind: model.kind,
          })
          .where(eq(aiModels.id, row.id));
      } else {
        await db.insert(aiModels).values({
          providerId: provider.id,
          modelId: model.modelId,
          displayName: model.displayName,
          kind: model.kind,
          capabilities: model.capabilities,
          contextWindow: model.contextWindow,
          enabled: true,
        });
      }
    }

    if (discoveredIds.length > 0) {
      await db
        .update(aiModels)
        .set({ enabled: false })
        .where(and(eq(aiModels.providerId, provider.id), notInArray(aiModels.modelId, discoveredIds)));
    }

    const models = await db.query.aiModels.findMany({
      where: inArray(aiModels.providerId, [provider.id]),
      orderBy: (t, { asc }) => asc(t.modelId),
    });
    return Response.json({ models, discovered: discovered.length });
  } catch (err) {
    return errorResponse(err);
  }
}
