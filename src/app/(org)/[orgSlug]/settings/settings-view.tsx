"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const NONE = "__none__";

export function SettingsView({
  orgSlug,
  orgName,
  models,
  defaultModelId,
  autoKnowledge,
  webResearch,
}: {
  orgSlug: string;
  orgName: string;
  models: { id: string; label: string }[];
  defaultModelId: string | null;
  autoKnowledge: boolean;
  webResearch: boolean;
}) {
  const [model, setModel] = useState(defaultModelId ?? NONE);
  const [autoKb, setAutoKb] = useState(autoKnowledge);
  const [web, setWeb] = useState(webResearch);

  async function patch(body: Record<string, unknown>, onFail: () => void, ok: string) {
    const res = await fetch(`/api/orgs/${orgSlug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      onFail();
      toast.error("Could not update setting");
      return;
    }
    toast.success(ok);
  }

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage {orgName}&apos;s defaults for projects and deliverables.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Default AI model</CardTitle>
          <CardDescription>
            The model every project subagent uses to analyze sources and produce deliverables. Defaults to the first
            enabled chat model.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-md border p-3">
            <Label className="text-sm font-medium">Model</Label>
            <Select
              value={model}
              onValueChange={(v) => {
                const prev = model;
                setModel(v);
                void patch({ defaultModelId: v === NONE ? null : v }, () => setModel(prev), "Default model updated");
              }}
            >
              <SelectTrigger className="ml-auto w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>First available model</SelectItem>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Knowledge & research</CardTitle>
          <CardDescription>How the workspace learns and gathers evidence.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">Auto-capture knowledge from work</div>
              <div className="text-xs text-muted-foreground">
                Substantive chat answers are filed into the knowledge base (heuristic-gated and deduped) so future work
                builds on them.
              </div>
            </div>
            <Switch
              checked={autoKb}
              onCheckedChange={(v) => {
                setAutoKb(v);
                void patch({ autoKnowledge: v }, () => setAutoKb(!v), v ? "Auto-capture enabled" : "Auto-capture disabled");
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">Web research</div>
              <div className="text-xs text-muted-foreground">
                Let the researcher subagent search and read the web (free, key-less) while producing deliverables.
              </div>
            </div>
            <Switch
              checked={web}
              onCheckedChange={(v) => {
                setWeb(v);
                void patch({ webResearch: v }, () => setWeb(!v), v ? "Web research enabled" : "Web research disabled");
              }}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
