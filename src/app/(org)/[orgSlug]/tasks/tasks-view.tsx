"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, ClipboardList, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
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
import { Markdown } from "@/components/chat/markdown";

interface TaskAgent {
  id: string;
  name: string;
  title: string;
  avatarColor: string | null;
}

interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  result: string | null;
  error: string | null;
  agent: TaskAgent | null;
  subtasks?: TaskItem[];
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return (
        <Badge variant="success">
          <CheckCircle2 />
          completed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive">
          <CircleAlert />
          failed
        </Badge>
      );
    case "in_progress":
      return (
        <Badge variant="warning">
          <Loader2 className="animate-spin" />
          in progress
        </Badge>
      );
    case "cancelled":
      return <Badge variant="outline">cancelled</Badge>;
    default:
      return <Badge variant="outline">queued</Badge>;
  }
}

export function TasksView({ orgSlug, agents }: { orgSlug: string; agents: TaskAgent[] }) {
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orgs/${orgSlug}/tasks`);
    if (res.ok) {
      const body = await res.json();
      setTasks(body.tasks);
    }
  }, [orgSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while anything is still running.
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
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}

      {creating && (
        <DelegateDialog
          orgSlug={orgSlug}
          agents={agents}
          onClose={(saved) => {
            setCreating(false);
            if (saved) void load();
          }}
        />
      )}
    </>
  );
}

function TaskCard({ task }: { task: TaskItem }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(task.result || task.error || (task.subtasks && task.subtasks.length > 0));

  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-3 px-4">
        <button
          className={cn("flex items-center gap-3 text-left", hasDetail && "cursor-pointer")}
          onClick={() => hasDetail && setOpen(!open)}
        >
          {hasDetail ? (
            open ? (
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            )
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{task.title}</div>
            {task.description && <div className="truncate text-xs text-muted-foreground">{task.description}</div>}
          </div>
          {task.agent && (
            <div className="flex items-center gap-2">
              <AgentAvatar name={task.agent.name} color={task.agent.avatarColor} size="sm" />
              <span className="hidden text-xs text-muted-foreground sm:inline">{task.agent.name}</span>
            </div>
          )}
          <StatusBadge status={task.status} />
        </button>

        {open && (
          <div className="flex flex-col gap-3 border-t pt-3">
            {task.subtasks && task.subtasks.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground">
                  Delegated to {task.subtasks.length} report{task.subtasks.length === 1 ? "" : "s"}
                </div>
                {task.subtasks.map((subtask) => (
                  <SubtaskRow key={subtask.id} subtask={subtask} />
                ))}
              </div>
            )}
            {task.error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {task.error}
              </div>
            )}
            {task.result && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="pb-2 text-xs font-medium text-muted-foreground">Deliverable</div>
                <Markdown>{task.result}</Markdown>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SubtaskRow({ subtask }: { subtask: TaskItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
        onClick={() => setOpen(!open)}
      >
        {subtask.agent && <AgentAvatar name={subtask.agent.name} color={subtask.agent.avatarColor} size="sm" />}
        <span className="min-w-0 flex-1 truncate">{subtask.title}</span>
        <StatusBadge status={subtask.status} />
      </button>
      {open && (subtask.result || subtask.error || subtask.description) && (
        <div className="flex flex-col gap-2 border-t px-3 py-2 text-sm">
          {subtask.description && <p className="text-xs text-muted-foreground">{subtask.description}</p>}
          {subtask.error && <p className="text-destructive">{subtask.error}</p>}
          {subtask.result && <Markdown>{subtask.result}</Markdown>}
        </div>
      )}
    </div>
  );
}

function DelegateDialog({
  orgSlug,
  agents,
  onClose,
}: {
  orgSlug: string;
  agents: TaskAgent[];
  onClose: (saved: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coordinatorAgentId, setCoordinatorAgentId] = useState(agents[0]?.id ?? "");
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
                    {agent.name} — {agent.title}
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
