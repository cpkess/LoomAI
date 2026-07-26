import type { EmbeddingModel, LanguageModel } from "ai";

import type { ModelCapabilities, ProviderType } from "@/lib/db/schema";

/** A configured provider instance (DB row with the API key decrypted). */
export interface ProviderInstance {
  id: string;
  type: ProviderType;
  name: string;
  baseUrl: string;
  apiKey?: string;
  config: Record<string, unknown>;
}

export interface DiscoveredModel {
  modelId: string;
  displayName?: string;
  kind: "chat" | "embedding";
  capabilities: ModelCapabilities;
  contextWindow?: number;
  /** Whether the model is currently loaded (local engines like LM Studio). */
  loaded?: boolean;
}

export interface ProviderHealth {
  ok: boolean;
  latencyMs: number;
  message: string;
  loadedModels?: string[];
}

/**
 * Provider plugin interface. Every inference backend implements this and is
 * registered in lib/ai/registry — nothing outside lib/ai/providers may
 * contain provider-specific logic. Providers are interchangeable: switching
 * one never requires changing application code.
 */
export interface AIProviderPlugin {
  type: ProviderType;
  label: string;
  /** Default base URL suggested in the admin UI, if any. */
  defaultBaseUrl?: string;
  requiresApiKey: boolean;
  supportsEmbeddings: boolean;
  /** Build an AI SDK language model for a chat model id. */
  languageModel(instance: ProviderInstance, modelId: string): LanguageModel;
  /** Build an AI SDK embedding model for an embedding model id. */
  embeddingModel(instance: ProviderInstance, modelId: string): EmbeddingModel;
  /** Discover the models this instance currently serves. */
  listModels(instance: ProviderInstance): Promise<DiscoveredModel[]>;
  /** Reachability / status probe used by the admin dashboard. */
  healthCheck(instance: ProviderInstance): Promise<ProviderHealth>;
}

/** fetch with a hard timeout, for health checks and discovery probes. */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
