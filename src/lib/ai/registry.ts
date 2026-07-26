import { eq } from "drizzle-orm";
import type { EmbeddingModel, LanguageModel } from "ai";

import { decryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { aiModels, aiProviders, type AiModel, type AiProvider, type ProviderType } from "@/lib/db/schema";

import { anthropicPlugin } from "./providers/anthropic";
import { lmStudioPlugin } from "./providers/lmstudio";
import { ollamaPlugin } from "./providers/ollama";
import { openAICompatiblePlugin } from "./providers/openai-compatible";
import type { AIProviderPlugin, ProviderInstance } from "./types";

// The provider registry maps provider types to plugins and resolves
// DB-configured provider instances + models into runnable AI SDK models.
// This is the only place the mapping lives; everything else asks the
// registry, which keeps providers interchangeable.

const plugins: Record<ProviderType, AIProviderPlugin> = {
  lmstudio: lmStudioPlugin,
  openai_compatible: openAICompatiblePlugin,
  ollama: ollamaPlugin,
  anthropic: anthropicPlugin,
};

export function getPlugin(type: ProviderType): AIProviderPlugin {
  return plugins[type];
}

export function listPlugins(): AIProviderPlugin[] {
  return Object.values(plugins);
}

export function toInstance(row: AiProvider): ProviderInstance {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    baseUrl: row.baseUrl,
    apiKey: row.apiKeyEncrypted ? decryptSecret(row.apiKeyEncrypted) : undefined,
    config: (row.config ?? {}) as Record<string, unknown>,
  };
}

export interface ResolvedChatModel {
  model: LanguageModel;
  modelRow: AiModel;
  providerRow: AiProvider;
}

/** Resolve an ai_models row id into a runnable chat model. */
export async function resolveChatModel(modelDbId: string): Promise<ResolvedChatModel> {
  const modelRow = await db.query.aiModels.findFirst({ where: eq(aiModels.id, modelDbId) });
  if (!modelRow || !modelRow.enabled) throw new Error("Model not found or disabled");
  const providerRow = await db.query.aiProviders.findFirst({ where: eq(aiProviders.id, modelRow.providerId) });
  if (!providerRow || !providerRow.enabled) throw new Error("Provider not found or disabled");
  const plugin = getPlugin(providerRow.type);
  return { model: plugin.languageModel(toInstance(providerRow), modelRow.modelId), modelRow, providerRow };
}

export interface ResolvedEmbeddingModel {
  model: EmbeddingModel;
  modelRow: AiModel;
  providerRow: AiProvider;
}

/** Resolve an ai_models row id into a runnable embedding model. */
export async function resolveEmbeddingModel(modelDbId: string): Promise<ResolvedEmbeddingModel> {
  const modelRow = await db.query.aiModels.findFirst({ where: eq(aiModels.id, modelDbId) });
  if (!modelRow || !modelRow.enabled) throw new Error("Embedding model not found or disabled");
  const providerRow = await db.query.aiProviders.findFirst({ where: eq(aiProviders.id, modelRow.providerId) });
  if (!providerRow || !providerRow.enabled) throw new Error("Provider not found or disabled");
  const plugin = getPlugin(providerRow.type);
  return { model: plugin.embeddingModel(toInstance(providerRow), modelRow.modelId), modelRow, providerRow };
}

/** All enabled chat models across enabled providers (for model pickers). */
export async function listEnabledModels(kind?: "chat" | "embedding") {
  const rows = await db
    .select({ model: aiModels, provider: aiProviders })
    .from(aiModels)
    .innerJoin(aiProviders, eq(aiModels.providerId, aiProviders.id))
    .where(eq(aiModels.enabled, true));
  return rows
    .filter((r) => r.provider.enabled && (!kind || r.model.kind === kind))
    .map((r) => ({
      id: r.model.id,
      modelId: r.model.modelId,
      displayName: r.model.displayName ?? r.model.modelId,
      kind: r.model.kind,
      capabilities: r.model.capabilities,
      providerName: r.provider.name,
      providerType: r.provider.type,
    }));
}

export type EnabledModel = Awaited<ReturnType<typeof listEnabledModels>>[number];
