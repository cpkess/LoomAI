import { listEnabledModels } from "@/lib/ai/registry";
import { requireOrgPage } from "@/lib/auth/authorize";

import { SettingsView } from "./settings-view";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug, "org_admin");
  const models = await listEnabledModels("chat");

  const settings = (ctx.org.settings ?? {}) as {
    defaultModelId?: string;
    autoKnowledge?: boolean;
    webResearch?: boolean;
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <SettingsView
        orgSlug={ctx.org.slug}
        orgName={ctx.org.name}
        models={models.map((m) => ({ id: m.id, label: `${m.displayName} · ${m.providerName}` }))}
        defaultModelId={settings.defaultModelId ?? null}
        autoKnowledge={settings.autoKnowledge !== false}
        webResearch={settings.webResearch !== false}
      />
    </div>
  );
}
