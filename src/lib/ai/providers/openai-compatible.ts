import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import {
  fetchWithTimeout,
  stripTrailingSlash,
  type AIProviderPlugin,
  type DiscoveredModel,
  type ProviderHealth,
  type ProviderInstance,
} from "../types";

// Covers OpenAI, Azure OpenAI (with base URL), OpenRouter, vLLM, llama.cpp
// server, and any other endpoint speaking the OpenAI /v1 API.

function client(instance: ProviderInstance) {
  return createOpenAICompatible({
    name: instance.name,
    baseURL: stripTrailingSlash(instance.baseUrl),
    apiKey: instance.apiKey,
    includeUsage: true,
  });
}

function looksLikeEmbeddingModel(id: string): boolean {
  return /embed|bge-|minilm|e5-/i.test(id);
}

export async function listOpenAIStyleModels(instance: ProviderInstance): Promise<DiscoveredModel[]> {
  const res = await fetchWithTimeout(`${stripTrailingSlash(instance.baseUrl)}/models`, {
    headers: instance.apiKey ? { Authorization: `Bearer ${instance.apiKey}` } : {},
  });
  if (!res.ok) throw new Error(`GET /models returned ${res.status}`);
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => {
    const embedding = looksLikeEmbeddingModel(m.id);
    return {
      modelId: m.id,
      kind: embedding ? "embedding" : "chat",
      capabilities: embedding ? { embeddings: true } : { tools: true, structuredOutput: true },
    };
  });
}

export const openAICompatiblePlugin: AIProviderPlugin = {
  type: "openai_compatible",
  label: "OpenAI-compatible",
  requiresApiKey: false,
  supportsEmbeddings: true,

  languageModel(instance, modelId) {
    return client(instance)(modelId);
  },

  embeddingModel(instance, modelId) {
    return client(instance).embeddingModel(modelId);
  },

  listModels: listOpenAIStyleModels,

  async healthCheck(instance): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      const models = await listOpenAIStyleModels(instance);
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: `Reachable, ${models.length} model${models.length === 1 ? "" : "s"} available`,
      };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, message: err instanceof Error ? err.message : String(err) };
    }
  },
};
