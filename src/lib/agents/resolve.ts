import { listEnabledModels } from "@/lib/ai/registry";

/** First enabled chat model, so fresh installs work without per-org setup. */
export async function fallbackModelId(): Promise<string | null> {
  const models = await listEnabledModels("chat");
  return models[0]?.id ?? null;
}
