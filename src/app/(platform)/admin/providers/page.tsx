import { asc } from "drizzle-orm";

import { requirePlatformAdmin } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { aiModels, aiProviders } from "@/lib/db/schema";

import { ProvidersView } from "./providers-view";

export const metadata = { title: "AI providers" };
export const dynamic = "force-dynamic";

export default async function ProvidersPage() {
  await requirePlatformAdmin();

  const providers = await db.query.aiProviders.findMany({ orderBy: asc(aiProviders.createdAt) });
  const models = await db.query.aiModels.findMany({ orderBy: asc(aiModels.modelId) });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">AI providers</h1>
        <p className="text-sm text-muted-foreground">
          Register inference engines and control which models are available to organizations. LM Studio and other
          local engines are first-class citizens.
        </p>
      </div>
      <ProvidersView
        providers={providers.map((p) => ({
          id: p.id,
          type: p.type,
          name: p.name,
          baseUrl: p.baseUrl,
          enabled: p.enabled,
          hasApiKey: Boolean(p.apiKeyEncrypted),
        }))}
        models={models.map((m) => ({
          id: m.id,
          providerId: m.providerId,
          modelId: m.modelId,
          displayName: m.displayName,
          kind: m.kind,
          enabled: m.enabled,
          contextWindow: m.contextWindow,
          capabilities: m.capabilities as Record<string, unknown>,
        }))}
      />
    </div>
  );
}
