import { createAnthropic } from "@ai-sdk/anthropic";

import {
  fetchWithTimeout,
  stripTrailingSlash,
  type AIProviderPlugin,
  type DiscoveredModel,
  type ProviderHealth,
  type ProviderInstance,
} from "../types";

const ANTHROPIC_VERSION = "2023-06-01";

function root(instance: ProviderInstance): string {
  return stripTrailingSlash(instance.baseUrl || "https://api.anthropic.com");
}

function client(instance: ProviderInstance) {
  return createAnthropic({
    apiKey: instance.apiKey,
    baseURL: `${root(instance)}/v1`,
  });
}

async function fetchModels(instance: ProviderInstance): Promise<DiscoveredModel[]> {
  const res = await fetchWithTimeout(`${root(instance)}/v1/models?limit=100`, {
    headers: {
      "x-api-key": instance.apiKey ?? "",
      "anthropic-version": ANTHROPIC_VERSION,
    },
  });
  if (!res.ok) throw new Error(`Anthropic API returned ${res.status}`);
  const body = (await res.json()) as { data?: { id: string; display_name?: string }[] };
  return (body.data ?? []).map((m) => ({
    modelId: m.id,
    displayName: m.display_name,
    kind: "chat" as const,
    capabilities: { vision: true, tools: true, structuredOutput: true, contextWindow: 200000 },
    contextWindow: 200000,
  }));
}

export const anthropicPlugin: AIProviderPlugin = {
  type: "anthropic",
  label: "Anthropic",
  defaultBaseUrl: "https://api.anthropic.com",
  requiresApiKey: true,
  supportsEmbeddings: false,

  languageModel(instance, modelId) {
    return client(instance)(modelId);
  },

  embeddingModel() {
    throw new Error("Anthropic does not provide embedding models");
  },

  listModels: fetchModels,

  async healthCheck(instance): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      const models = await fetchModels(instance);
      return { ok: true, latencyMs: Date.now() - started, message: `Reachable, ${models.length} models available` };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, message: err instanceof Error ? err.message : String(err) };
    }
  },
};
