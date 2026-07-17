"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function NewChat({
  orgSlug,
  workspaceSlug,
  workspaceName,
  staff,
  models,
  prompts,
}: {
  orgSlug: string;
  workspaceSlug: string;
  workspaceName: string;
  staff: { id: string; name: string; title: string; avatarColor: string | null }[];
  models: { id: string; label: string }[];
  prompts: { id: string; name: string; category: string }[];
}) {
  const router = useRouter();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [modelDbId, setModelDbId] = useState<string | undefined>();
  const [systemPromptId, setSystemPromptId] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function start() {
    setPending(true);
    const res = await fetch(`/api/orgs/${orgSlug}/w/${workspaceSlug}/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        agentId ? { agentId } : { modelDbId: modelDbId || undefined, systemPromptId: systemPromptId || undefined }
      ),
    });
    const body = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not start conversation");
      return;
    }
    router.push(`/${orgSlug}/w/${workspaceSlug}/c/${body.conversation.id}`);
    router.refresh();
  }

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="flex w-full max-w-xl flex-col gap-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Start a conversation in {workspaceName}</h1>
          <p className="text-sm text-muted-foreground">
            Talk to one of the department&apos;s AI employees, or open a plain chat with any model.
          </p>
        </div>

        {staff.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label>AI employees</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {staff.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => setAgentId(agentId === agent.id ? null : agent.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent",
                    agentId === agent.id && "border-primary bg-accent"
                  )}
                >
                  <AgentAvatar name={agent.name} color={agent.avatarColor} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{agent.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{agent.title}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <Card className={cn("py-4 transition-opacity", agentId && "opacity-50")}>
          <CardContent className="flex flex-col gap-4 px-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MessageSquare className="size-4" />
              Plain chat
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>Model</Label>
                <Select value={modelDbId} onValueChange={(v) => { setModelDbId(v); setAgentId(null); }}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={models.length ? "Workspace default" : "No models available"} />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>System prompt</Label>
                <Select value={systemPromptId} onValueChange={(v) => { setSystemPromptId(v); setAgentId(null); }}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    {prompts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Button onClick={start} disabled={pending} size="lg">
          <Sparkles />
          {pending ? "Starting…" : agentId ? `Chat with ${staff.find((s) => s.id === agentId)?.name}` : "Start chat"}
        </Button>
      </div>
    </div>
  );
}
