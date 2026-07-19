import { eq } from "drizzle-orm";

import { listEnabledModels } from "@/lib/ai/registry";
import { getGovernance } from "@/lib/company/actions";
import { requireOrgPage } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";

import { SettingsView } from "./settings-view";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgPage(orgSlug, "org_admin");

  const [departments, models] = await Promise.all([
    db.query.workspaces.findMany({
      where: eq(workspaces.organizationId, ctx.org.id),
      orderBy: (t, { asc }) => asc(t.name),
    }),
    listEnabledModels("chat"),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <SettingsView
        orgSlug={ctx.org.slug}
        orgName={ctx.org.name}
        departments={departments.map((d) => ({
          id: d.id,
          name: d.name,
          slug: d.slug,
          description: d.description,
          defaultModelId: ((d.settings ?? {}) as { defaultModelId?: string }).defaultModelId ?? null,
        }))}
        models={models.map((m) => ({ id: m.id, label: `${m.displayName} · ${m.providerName}` }))}
        governance={getGovernance(ctx.org)}
        autoKnowledge={((ctx.org.settings ?? {}) as { autoKnowledge?: boolean }).autoKnowledge !== false}
      />
    </div>
  );
}
