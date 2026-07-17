"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Pencil, Play, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface AgentRow {
  id: string;
  name: string;
  title: string;
  status: string;
  avatarColor: string | null;
  modelId: string | null;
  personaPromptId: string | null;
  personaText: string | null;
  reportsToAgentId: string | null;
  reportsToUserId: string | null;
  workspaceIds: string[];
  collectionIds: string[];
}

interface Option {
  id: string;
  name?: string;
  label?: string;
}

const NONE = "__none__";

export function AgentsView({
  orgSlug,
  canManage,
  agents,
  departments,
  collections,
  prompts,
  models,
  humans,
}: {
  orgSlug: string;
  canManage: boolean;
  agents: AgentRow[];
  departments: Option[];
  collections: Option[];
  prompts: Option[];
  models: Option[];
  humans: Option[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<AgentRow | null>(null);
  const [hiring, setHiring] = useState(false);

  async function setStatus(agent: AgentRow, status: "active" | "paused") {
    const res = await fetch(`/api/orgs/${orgSlug}/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      toast.error("Could not update agent");
      return;
    }
    toast.success(status === "paused" ? `${agent.name} paused` : `${agent.name} is back to work`);
    router.refresh();
  }

  async function remove(agent: AgentRow) {
    if (!confirm(`Offboard ${agent.name}? Their conversations remain but they stop responding.`)) return;
    const res = await fetch(`/api/orgs/${orgSlug}/agents/${agent.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not remove agent");
      return;
    }
    toast.success(`${agent.name} offboarded`);
    router.refresh();
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">AI employees</h1>
          <p className="text-sm text-muted-foreground">
            Hire, configure, and manage the AI members of your organization.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setHiring(true)}>
            <UserPlus />
            Hire AI employee
          </Button>
        )}
      </div>

      {agents.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No AI employees yet. {canManage ? "Hire your first one to get started." : "Ask an organization admin to hire one."}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => (
          <Card key={agent.id} className="py-4">
            <CardContent className="flex flex-col gap-3 px-4">
              <div className="flex items-center gap-3">
                <AgentAvatar name={agent.name} color={agent.avatarColor} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{agent.name}</div>
                  <div className="truncate text-sm text-muted-foreground">{agent.title}</div>
                </div>
                <Badge variant={agent.status === "active" ? "success" : "outline"}>{agent.status}</Badge>
              </div>
              <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                {agent.workspaceIds.length > 0 ? (
                  agent.workspaceIds.map((id) => (
                    <Badge key={id} variant="secondary">
                      {departments.find((d) => d.id === id)?.name ?? "?"}
                    </Badge>
                  ))
                ) : (
                  <span>Not staffed in any department</span>
                )}
              </div>
              {canManage && (
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => setEditing(agent)}>
                    <Pencil />
                    Edit
                  </Button>
                  {agent.status === "active" ? (
                    <Button variant="outline" size="sm" onClick={() => setStatus(agent, "paused")}>
                      <Pause />
                      Pause
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setStatus(agent, "active")}>
                      <Play />
                      Resume
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="ml-auto text-destructive" onClick={() => remove(agent)}>
                    <Trash2 />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {(hiring || editing) && (
        <AgentDialog
          orgSlug={orgSlug}
          agent={editing}
          departments={departments}
          collections={collections}
          prompts={prompts}
          models={models}
          humans={humans}
          otherAgents={agents.filter((a) => a.id !== editing?.id)}
          onClose={(saved) => {
            setHiring(false);
            setEditing(null);
            if (saved) router.refresh();
          }}
        />
      )}
    </>
  );
}

function AgentDialog({
  orgSlug,
  agent,
  departments,
  collections,
  prompts,
  models,
  humans,
  otherAgents,
  onClose,
}: {
  orgSlug: string;
  agent: AgentRow | null;
  departments: Option[];
  collections: Option[];
  prompts: Option[];
  models: Option[];
  humans: Option[];
  otherAgents: AgentRow[];
  onClose: (saved: boolean) => void;
}) {
  const [name, setName] = useState(agent?.name ?? "");
  const [title, setTitle] = useState(agent?.title ?? "");
  const [modelId, setModelId] = useState(agent?.modelId ?? NONE);
  const [personaPromptId, setPersonaPromptId] = useState(agent?.personaPromptId ?? NONE);
  const [personaText, setPersonaText] = useState(agent?.personaText ?? "");
  const [manager, setManager] = useState(
    agent?.reportsToUserId ? `user:${agent.reportsToUserId}` : agent?.reportsToAgentId ? `agent:${agent.reportsToAgentId}` : NONE
  );
  const [workspaceIds, setWorkspaceIds] = useState<string[]>(agent?.workspaceIds ?? []);
  const [collectionIds, setCollectionIds] = useState<string[]>(agent?.collectionIds ?? []);
  const [pending, setPending] = useState(false);

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const payload = {
      name,
      title,
      modelId: modelId === NONE ? null : modelId,
      personaPromptId: personaPromptId === NONE ? null : personaPromptId,
      personaText: personaText || null,
      reportsToUserId: manager.startsWith("user:") ? manager.slice(5) : null,
      reportsToAgentId: manager.startsWith("agent:") ? manager.slice(6) : null,
      workspaceIds,
      collectionIds,
    };
    const res = await fetch(agent ? `/api/orgs/${orgSlug}/agents/${agent.id}` : `/api/orgs/${orgSlug}/agents`, {
      method: agent ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not save agent");
      return;
    }
    toast.success(agent ? `${name} updated` : `${name} joined the team 🎉`);
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{agent ? `Edit ${agent.name}` : "Hire an AI employee"}</DialogTitle>
          <DialogDescription>
            AI employees have a job title, a place in the org chart, a persona, a model, and knowledge.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="agent-name">Name</Label>
              <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Atlas" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="agent-title">Job title</Label>
              <Input
                id="agent-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Principal Engineer (AI)"
                required
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Model</Label>
              <Select value={modelId} onValueChange={setModelId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Workspace default</SelectItem>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Reports to</Label>
              <Select value={manager} onValueChange={setManager}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nobody (unassigned)</SelectItem>
                  {humans.map((h) => (
                    <SelectItem key={h.id} value={`user:${h.id}`}>
                      {h.name} (human)
                    </SelectItem>
                  ))}
                  {otherAgents.map((a) => (
                    <SelectItem key={a.id} value={`agent:${a.id}`}>
                      {a.name} (AI)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Persona prompt (from library)</Label>
            <Select value={personaPromptId} onValueChange={setPersonaPromptId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None — use custom persona below</SelectItem>
                {prompts.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="agent-persona">Custom persona</Label>
            <Textarea
              id="agent-persona"
              value={personaText}
              onChange={(e) => setPersonaText(e.target.value)}
              placeholder="You are Atlas, a pragmatic principal engineer who values simple designs…"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Takes precedence over the library prompt when both are set.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Departments</Label>
            <div className="flex flex-wrap gap-2">
              {departments.map((d) => (
                <label key={d.id} className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-sm has-checked:border-primary has-checked:bg-accent">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={workspaceIds.includes(d.id)}
                    onChange={() => toggle(workspaceIds, setWorkspaceIds, d.id)}
                  />
                  {d.name}
                </label>
              ))}
              {departments.length === 0 && <p className="text-xs text-muted-foreground">No departments yet.</p>}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Knowledge collections</Label>
            <div className="flex flex-wrap gap-2">
              {collections.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-sm has-checked:border-primary has-checked:bg-accent">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={collectionIds.includes(c.id)}
                    onChange={() => toggle(collectionIds, setCollectionIds, c.id)}
                  />
                  {c.name}
                </label>
              ))}
              {collections.length === 0 && <p className="text-xs text-muted-foreground">No collections yet.</p>}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : agent ? "Save changes" : "Hire"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
