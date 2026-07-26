"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, GitCommitHorizontal, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Status {
  enabled: boolean;
  ref: string;
  repoUrl: string;
  current: { sha: string; shortSha: string; subject: string; date: string | null } | null;
  remoteSha: string | null;
  updateAvailable: boolean;
}

export function SoftwareView() {
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async () => {
    setChecking(true);
    const res = await fetch("/api/admin/update");
    setChecking(false);
    if (res.ok) setStatus(await res.json());
    else toast.error("Could not check for updates");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function update() {
    if (!confirm("Update LoomAI now? The app will pull the latest version, rebuild, and restart — it'll be briefly unavailable.")) {
      return;
    }
    setUpdating(true);
    const res = await fetch("/api/admin/update", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setUpdating(false);
      toast.error(body.error ?? "Could not start the update");
      return;
    }
    toast.success("Updating… the app is restarting. This page will reconnect in a minute or two.");
    // Poll until the server comes back on the new version.
    setTimeout(function poll() {
      fetch("/api/admin/update")
        .then((r) => {
          if (r.ok) {
            setUpdating(false);
            void load();
          } else {
            setTimeout(poll, 4000);
          }
        })
        .catch(() => setTimeout(poll, 4000));
    }, 15000);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Version</CardTitle>
            <CardDescription>
              Tracks <span className="font-mono text-xs">{status?.ref ?? "…"}</span> on{" "}
              <span className="font-mono text-xs">{status?.repoUrl?.replace(/^https?:\/\//, "") ?? "GitHub"}</span>.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" disabled={checking} onClick={load}>
            {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Check
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-md border p-3">
          <GitCommitHorizontal className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {status?.current ? (
                <>
                  Running <span className="font-mono">{status.current.shortSha}</span> — {status.current.subject}
                </>
              ) : (
                "Current version unknown"
              )}
            </div>
            {status?.current?.date && (
              <div className="text-xs text-muted-foreground">{new Date(status.current.date).toLocaleString()}</div>
            )}
          </div>
        </div>

        {status && (
          <>
            {status.updateAvailable ? (
              <div className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning/10 p-3">
                <div className="text-sm font-medium text-warning">
                  An update is available{status.remoteSha ? ` (${status.remoteSha.slice(0, 7)})` : ""}.
                </div>
                {status.enabled ? (
                  <Button className="self-start" disabled={updating} onClick={update}>
                    {updating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    {updating ? "Updating…" : "Update & restart"}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    In-app update is disabled. Set <span className="font-mono">LOOMAI_SELF_UPDATE=1</span> on the app
                    container to enable one-click updates, or run{" "}
                    <span className="font-mono">git pull &amp;&amp; docker compose up -d --build</span>.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
                <CheckCircle2 className="size-4 text-emerald-500" />
                {status.remoteSha ? "You're on the latest version." : "Could not reach GitHub to compare versions."}
              </div>
            )}
            {status.enabled && !status.updateAvailable && status.remoteSha && (
              <Button variant="outline" className="self-start" disabled={updating} onClick={update}>
                {updating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Reinstall latest &amp; restart
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
