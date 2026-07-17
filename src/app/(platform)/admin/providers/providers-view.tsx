"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Plus, RefreshCw, Radar, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface ProviderItem {
  id: string;
  type: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  hasApiKey: boolean;
}

export interface ModelItem {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string | null;
  kind: string;
  enabled: boolean;
  contextWindow: number | null;
  capabilities: Record<string, unknown>;
}

const PROVIDER_TYPES = [
  { value: "lmstudio", label: "LM Studio", defaultBaseUrl: "http://localhost:1234" },
  { value: "openai_compatible", label: "OpenAI-compatible (OpenAI, OpenRouter, vLLM…)", defaultBaseUrl: "https://api.openai.com/v1" },
  { value: "ollama", label: "Ollama", defaultBaseUrl: "http://localhost:11434" },
  { value: "anthropic", label: "Anthropic", defaultBaseUrl: "https://api.anthropic.com" },
];

export function ProvidersView({ providers, models }: { providers: ProviderItem[]; models: ModelItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, { ok: boolean; message: string; latencyMs: number }>>({});

  async function api(path: string, init?: RequestInit): Promise<Record<string, unknown> | null> {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error((body as { error?: string }).error ?? `Request failed (${res.status})`);
      return null;
    }
    return body as Record<string, unknown>;
  }

  async function checkHealth(provider: ProviderItem) {
    setBusy(`health-${provider.id}`);
    const body = await api(`/api/admin/providers/${provider.id}/health`, { method: "POST" });
    if (body) {
      const h = body.health as { ok: boolean; message: string; latencyMs: number };
      setHealth((prev) => ({ ...prev, [provider.id]: h }));
    }
    setBusy(null);
  }

  async function syncModels(provider: ProviderItem) {
    setBusy(`sync-${provider.id}`);
    const body = await api(`/api/admin/providers/${provider.id}/sync`, { method: "POST" });
    if (body) {
      toast.success(`Discovered ${body.discovered as number} models from ${provider.name}`);
      router.refresh();
    }
    setBusy(null);
  }

  async function toggleModel(model: ModelItem, enabled: boolean) {
    const body = await api(`/api/admin/models/${model.id}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
    if (body) router.refresh();
  }

  async function toggleProvider(provider: ProviderItem, enabled: boolean) {
    const body = await api(`/api/admin/providers/${provider.id}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
    if (body) router.refresh();
  }

  async function deleteProvider(provider: ProviderItem) {
    if (!confirm(`Remove provider "${provider.name}" and its models?`)) return;
    const body = await api(`/api/admin/providers/${provider.id}`, { method: "DELETE" });
    if (body) {
      toast.success("Provider removed");
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <AddProviderDialog onCreated={() => router.refresh()} api={api} />
        <DiscoverButton api={api} onFound={() => router.refresh()} />
      </div>

      {providers.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No providers registered yet. Add your LM Studio server to get started — chats and embeddings need at
            least one enabled provider.
          </CardContent>
        </Card>
      )}

      {providers.map((provider) => {
        const providerModels = models.filter((m) => m.providerId === provider.id);
        const h = health[provider.id];
        return (
          <Card key={provider.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <CardTitle className="flex items-center gap-2">
                    {provider.name}
                    <Badge variant="secondary">{PROVIDER_TYPES.find((t) => t.value === provider.type)?.label.split(" (")[0] ?? provider.type}</Badge>
                    {!provider.enabled && <Badge variant="outline">disabled</Badge>}
                    {h && (
                      <Badge variant={h.ok ? "success" : "destructive"}>
                        {h.ok ? `healthy · ${h.latencyMs}ms` : "unreachable"}
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {provider.baseUrl}
                    {h && !h.ok && <span className="block text-destructive">{h.message}</span>}
                    {h && h.ok && <span className="block">{h.message}</span>}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={provider.enabled} onCheckedChange={(v) => toggleProvider(provider, v)} />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === `health-${provider.id}`}
                    onClick={() => checkHealth(provider)}
                  >
                    <Activity />
                    Health
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === `sync-${provider.id}`}
                    onClick={() => syncModels(provider)}
                  >
                    <RefreshCw className={busy === `sync-${provider.id}` ? "animate-spin" : ""} />
                    Sync models
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteProvider(provider)}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {providerModels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No models synced yet. Use “Sync models” to discover what this provider serves.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Model</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Capabilities</TableHead>
                      <TableHead>Context</TableHead>
                      <TableHead className="text-right">Enabled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {providerModels.map((model) => (
                      <TableRow key={model.id}>
                        <TableCell className="font-medium">{model.displayName ?? model.modelId}</TableCell>
                        <TableCell>
                          <Badge variant={model.kind === "embedding" ? "outline" : "secondary"}>{model.kind}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {["vision", "tools", "structuredOutput", "embeddings"]
                            .filter((c) => model.capabilities?.[c])
                            .join(", ") || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {model.contextWindow ? model.contextWindow.toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Switch checked={model.enabled} onCheckedChange={(v) => toggleModel(model, v)} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function AddProviderDialog({
  onCreated,
  api,
}: {
  onCreated: () => void;
  api: (path: string, init?: RequestInit) => Promise<Record<string, unknown> | null>;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("lmstudio");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState(PROVIDER_TYPES[0].defaultBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState(false);

  function onTypeChange(value: string) {
    setType(value);
    const t = PROVIDER_TYPES.find((t) => t.value === value);
    if (t) setBaseUrl(t.defaultBaseUrl);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const body = await api("/api/admin/providers", {
      method: "POST",
      body: JSON.stringify({ type, name: name || PROVIDER_TYPES.find((t) => t.value === type)?.label, baseUrl, apiKey: apiKey || undefined }),
    });
    setPending(false);
    if (body) {
      toast.success("Provider added — now sync its models");
      setOpen(false);
      setName("");
      setApiKey("");
      onCreated();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Add provider
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add AI provider</DialogTitle>
          <DialogDescription>
            Register an inference engine. Local servers (LM Studio, Ollama) usually need no API key.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={onTypeChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="provider-name">Name</Label>
            <Input
              id="provider-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. LM Studio (workstation)"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="provider-url">Base URL</Label>
            <Input id="provider-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="provider-key">API key (optional)</Label>
            <Input
              id="provider-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Stored encrypted"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add provider"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DiscoverButton({
  api,
  onFound,
}: {
  api: (path: string, init?: RequestInit) => Promise<Record<string, unknown> | null>;
  onFound: () => void;
}) {
  const [pending, setPending] = useState(false);

  async function discover() {
    setPending(true);
    const body = await api("/api/admin/providers/discover", { method: "POST", body: JSON.stringify({}) });
    setPending(false);
    if (!body) return;
    const servers = body.servers as string[];
    if (servers.length === 0) {
      toast.info("No LM Studio servers found on well-known local hosts. Is the server running with 'lms server start'?");
      return;
    }
    for (const server of servers) {
      await api("/api/admin/providers", {
        method: "POST",
        body: JSON.stringify({ type: "lmstudio", name: `LM Studio (${new URL(server).host})`, baseUrl: server }),
      });
    }
    toast.success(`Registered ${servers.length} LM Studio server${servers.length === 1 ? "" : "s"}`);
    onFound();
  }

  return (
    <Button variant="outline" onClick={discover} disabled={pending}>
      <Radar className={pending ? "animate-pulse" : ""} />
      {pending ? "Scanning…" : "Auto-discover LM Studio"}
    </Button>
  );
}
