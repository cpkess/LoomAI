import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import {
  fetchWithTimeout,
  stripTrailingSlash,
  type AIProviderPlugin,
  type DiscoveredModel,
  type ProviderHealth,
  type ProviderInstance,
} from "../types";

// LM Studio is LoomAI's flagship local inference engine. It exposes two
// surfaces on the same server (default http://localhost:1234):
//   /v1      — OpenAI-compatible chat/embeddings, used for inference
//   /api/v0  — LM Studio's native REST API, used for its richer model
//              catalog (load state, quantization, max context, type) and
//              health checks.
// The base URL stored on the provider is the server root, without /v1.

interface LMStudioModel {
  id: string;
  type?: "llm" | "vlm" | "embeddings" | string;
  state?: "loaded" | "not-loaded" | "loading" | string;
  max_context_length?: number;
  capabilities?: string[];
  quantization?: string;
  publisher?: string;
}

function root(instance: ProviderInstance): string {
  // Accept base URLs entered with a trailing /v1 and normalize them away.
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

async function fetchCatalog(instance: ProviderInstance): Promise<LMStudioModel[]> {
  const base = root(instance);
  const res = await fetchWithTimeout(`${base}/api/v0/models`);
  if (res.ok) {
    const body = (await res.json()) as { data?: LMStudioModel[] };
    return body.data ?? [];
  }
  // Older LM Studio builds without /api/v0 — fall back to the OpenAI surface.
  const fallback = await fetchWithTimeout(`${base}/v1/models`);
  if (!fallback.ok) throw new Error(`LM Studio returned ${fallback.status}`);
  const body = (await fallback.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => ({ id: m.id }));
}

function toDiscovered(model: LMStudioModel): DiscoveredModel {
  const isEmbedding = model.type === "embeddings" || /embed/i.test(model.id);
  return {
    modelId: model.id,
    displayName: model.id,
    kind: isEmbedding ? "embedding" : "chat",
    contextWindow: model.max_context_length,
    loaded: model.state ? model.state === "loaded" : undefined,
    capabilities: isEmbedding
      ? { embeddings: true }
      : {
          vision: model.type === "vlm" || model.capabilities?.includes("vision") || undefined,
          tools: model.capabilities ? model.capabilities.includes("tool_use") : true,
          structuredOutput: true,
          contextWindow: model.max_context_length,
        },
  };
}

export const lmStudioPlugin: AIProviderPlugin = {
  type: "lmstudio",
  label: "LM Studio",
  defaultBaseUrl: "http://localhost:1234",
  requiresApiKey: false,
  supportsEmbeddings: true,

  languageModel(instance, modelId) {
    return client(instance)(modelId);
  },

  embeddingModel(instance, modelId) {
    return client(instance).embeddingModel(modelId);
  },

  async listModels(instance) {
    const catalog = await fetchCatalog(instance);
    return catalog.map(toDiscovered);
  },

  async healthCheck(instance): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      const catalog = await fetchCatalog(instance);
      const loaded = catalog.filter((m) => m.state === "loaded").map((m) => m.id);
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: `Reachable, ${catalog.length} models (${loaded.length} loaded)`,
        loadedModels: loaded,
      };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, message: err instanceof Error ? err.message : String(err) };
    }
  },
};

/**
 * Probe well-known hosts for running LM Studio servers. Used by the platform
 * admin "Auto-discover" action; extra hosts can be supplied for multi-machine
 * setups.
 */
export async function discoverLMStudioServers(extraHosts: string[] = []): Promise<string[]> {
  const candidates = [
    "http://localhost:1234",
    "http://127.0.0.1:1234",
    "http://host.docker.internal:1234",
    ...extraHosts,
  ];
  const found: string[] = [];
  await Promise.all(
    candidates.map(async (base) => {
      try {
        const res = await fetchWithTimeout(`${stripTrailingSlash(base)}/api/v0/models`, {}, 1500);
        if (res.ok) found.push(base);
      } catch {
        // not running there
      }
    })
  );
  // De-duplicate hosts that resolve to the same server (localhost vs 127.0.0.1)
  return found.filter((url, i) => found.findIndex((u) => u.replace("127.0.0.1", "localhost") === url.replace("127.0.0.1", "localhost")) === i);
}
