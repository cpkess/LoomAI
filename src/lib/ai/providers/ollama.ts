import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import {
  fetchWithTimeout,
  stripTrailingSlash,
  type AIProviderPlugin,
  type DiscoveredModel,
  type ProviderHealth,
  type ProviderInstance,
} from "../types";

// Ollama (default http://localhost:11434). Inference goes through Ollama's
// OpenAI-compatible /v1 surface; discovery uses the native /api/tags.

function root(instance: ProviderInstance): string {
  return stripTrailingSlash(instance.baseUrl).replace(/\/v1$/, "");
}

function client(instance: ProviderInstance) {
  return createOpenAICompatible({
    name: instance.name,
    baseURL: `${root(instance)}/v1`,
    apiKey: instance.apiKey,
    includeUsage: true,
  });
}

function isEmbeddingModel(name: string): boolean {
  return /embed|bge-|minilm|arctic-embed|e5-/i.test(name);
}

export const ollamaPlugin: AIProviderPlugin = {
  type: "ollama",
  label: "Ollama",
  defaultBaseUrl: "http://localhost:11434",
  requiresApiKey: false,
  supportsEmbeddings: true,

  languageModel(instance, modelId) {
    return client(instance)(modelId);
  },

  embeddingModel(instance, modelId) {
    return client(instance).embeddingModel(modelId);
  },

  async listModels(instance): Promise<DiscoveredModel[]> {
    const res = await fetchWithTimeout(`${root(instance)}/api/tags`);
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    const body = (await res.json()) as { models?: { name: string }[] };
    return (body.models ?? []).map((m) => {
      const embedding = isEmbeddingModel(m.name);
      return {
        modelId: m.name,
        kind: embedding ? "embedding" : "chat",
        capabilities: embedding ? { embeddings: true } : { tools: true, structuredOutput: true },
      };
    });
  },

  async healthCheck(instance): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      const res = await fetchWithTimeout(`${root(instance)}/api/tags`);
      if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
      const body = (await res.json()) as { models?: { name: string }[] };
      const n = body.models?.length ?? 0;
      return { ok: true, latencyMs: Date.now() - started, message: `Reachable, ${n} model${n === 1 ? "" : "s"} pulled` };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, message: err instanceof Error ? err.message : String(err) };
    }
  },
};
