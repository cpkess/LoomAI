import { count, eq, inArray } from "drizzle-orm";
import { Activity, Building2, Cpu, FileText, FolderKanban, MessagesSquare, Users } from "lucide-react";

import { getPlugin, toInstance } from "@/lib/ai/registry";
import { requirePlatformAdmin } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { aiModels, conversations, documents, organizations, projects, users } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Platform overview" };
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  await requirePlatformAdmin();

  const [[orgCount], [userCount], [projectCount], [documentCount], [conversationCount], [modelCount], providers] =
    await Promise.all([
      db.select({ value: count() }).from(organizations),
      db.select({ value: count() }).from(users),
      db.select({ value: count() }).from(projects),
      db.select({ value: count() }).from(documents),
      db.select({ value: count() }).from(conversations),
      db.select({ value: count() }).from(aiModels).where(eq(aiModels.enabled, true)),
      db.query.aiProviders.findMany({ orderBy: (t, { asc }) => asc(t.createdAt) }),
    ]);

  const [pendingDocs] = await db
    .select({ value: count() })
    .from(documents)
    .where(inArray(documents.status, ["pending", "processing"]));
  const [errorDocs] = await db.select({ value: count() }).from(documents).where(eq(documents.status, "error"));

  // Live health probe for each provider (short timeouts inside the plugins).
  const health = await Promise.all(
    providers.map(async (provider) => {
      const plugin = getPlugin(provider.type);
      try {
        return { provider, health: await plugin.healthCheck(toInstance(provider)) };
      } catch (err) {
        return {
          provider,
          health: { ok: false, latencyMs: 0, message: err instanceof Error ? err.message : String(err) },
        };
      }
    })
  );

  const stats = [
    { label: "Organizations", value: orgCount.value, icon: Building2 },
    { label: "Users", value: userCount.value, icon: Users },
    { label: "Projects", value: projectCount.value, icon: FolderKanban },
    { label: "Enabled models", value: modelCount.value, icon: Cpu },
    { label: "Documents", value: documentCount.value, icon: FileText },
    { label: "Conversations", value: conversationCount.value, icon: MessagesSquare },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Platform overview</h1>
        <p className="text-sm text-muted-foreground">Deployment-wide health and usage.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        {stats.map((stat) => (
          <Card key={stat.label} className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardDescription className="flex items-center gap-2">
                <stat.icon className="size-4" />
                {stat.label}
              </CardDescription>
              <CardTitle className="text-2xl tabular-nums">{stat.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4" />
              Provider health
            </CardTitle>
            <CardDescription>Live reachability of every registered inference engine.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {health.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No providers registered yet — add one under AI providers.
              </p>
            )}
            {health.map(({ provider, health: h }) => (
              <div key={provider.id} className="flex items-center gap-3 rounded-md border p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{provider.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {provider.baseUrl} · {h.message}
                  </div>
                </div>
                <Badge variant={h.ok ? "success" : "destructive"}>
                  {h.ok ? `healthy · ${h.latencyMs}ms` : "unreachable"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ingestion queue</CardTitle>
            <CardDescription>Document processing across all organizations.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between rounded-md border p-3">
              <span>In queue / processing</span>
              <Badge variant={pendingDocs.value > 0 ? "warning" : "secondary"}>{pendingDocs.value}</Badge>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <span>Failed documents</span>
              <Badge variant={errorDocs.value > 0 ? "destructive" : "secondary"}>{errorDocs.value}</Badge>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <span>Total documents</span>
              <Badge variant="secondary">{documentCount.value}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
