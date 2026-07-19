"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agents/agent-avatar";
import { TaskCard, type TaskAgent, type TaskItem } from "@/components/tasks/task-card";
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

export function TasksView({
  orgSlug,
  agents,
  defaultCoordinatorId,
}: {
  orgSlug: string;
  agents: TaskAgent[];
  defaultCoordinatorId: string | null;
}) {
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orgs/${orgSlug}/tasks`);
    if (res.ok) setTasks((await res.json()).tasks);
  }, [orgSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = tasks?.some((t) => t.status === "pending" || t.status === "in_progress") ?? false;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load(), 2500);
    return () => clearInterval(timer);
  }, [active, load]);

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Delegated tasks</h1>
          <p className="text-sm text-muted-foreground">
            Hand a task to an AI employee. Managers break it down across their reports and deliver the combined
            result.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={agents.length === 0}>
          <Plus />
          Delegate task
        </Button>
      </div>

      {tasks === null ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading tasks…
          </CardContent>
        </Card>
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <ClipboardList className="size-8" />
            No delegated tasks yet.
            {agents.length === 0 && <span>Hire an AI employee first.</span>}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              feedbackUrl={`/api/orgs/${orgSlug}/tasks/${task.id}/feedback`}
              onChanged={() => void load()}
            />
          ))}
        </div>
      )}

      {creating && (
        <DelegateDialog
          orgSlug={orgSlug}
          agents={agents}
          defaultCoordinatorId={defaultCoordinatorId}
          onClose={(saved) => {
            setCreating(false);
            if (saved) void load();
          }}
        />
      )}
    </>
  );
}

function DelegateDialog({
  orgSlug,
  agents,
  defaultCoordinatorId,
  onClose,
}: {
  orgSlug: string;
  agents: TaskAgent[];
  defaultCoordinatorId: string | null;
  onClose: (saved: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coordinatorAgentId, setCoordinatorAgentId] = useState(
    defaultCoordinatorId ?? agents[0]?.id ?? ""
  );
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await fetch(`/api/orgs/${orgSlug}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: description || undefined, coordinatorAgentId }),
    });
    const body = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not create task");
      return;
    }
    toast.success("Task delegated");
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delegate a task</DialogTitle>
          <DialogDescription>
            The assigned AI employee coordinates the work — if they have reports, they will split the task across
            them and combine the results.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Draft the Q3 product launch plan"
              required
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="task-description">Details</Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Context, constraints, expected deliverable…"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Assign to</Label>
            <Select value={coordinatorAgentId} onValueChange={setCoordinatorAgentId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick an AI employee" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    <span className="flex items-center gap-2">
                      <AgentAvatar name={agent.name} color={agent.avatarColor} size="sm" />
                      {agent.name} — {agent.title}
                      {agent.id === defaultCoordinatorId && (
                        <span className="text-xs text-muted-foreground">(CEO)</span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !coordinatorAgentId}>
              {pending ? "Delegating…" : "Delegate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
