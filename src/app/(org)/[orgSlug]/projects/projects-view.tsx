"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderKanban, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Markdown } from "@/components/chat/markdown";
import { StatusBadge, TaskCard, type TaskAgent, type TaskItem } from "@/components/tasks/task-card";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface ProjectListItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  summary: string | null;
  manager: TaskAgent | null;
  taskCount: number;
  doneCount: number;
}

export function ProjectsView({
  orgSlug,
  agents,
  defaultManagerId,
}: {
  orgSlug: string;
  agents: TaskAgent[];
  defaultManagerId: string | null;
}) {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orgs/${orgSlug}/projects`);
    if (res.ok) setProjects((await res.json()).projects);
  }, [orgSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = projects?.some((p) => p.status === "planning" || p.status === "in_progress") ?? false;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [active, load]);

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Bigger, multi-step initiatives. A project manager plans the project into tasks and can add more; each task
            runs through the org.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={agents.length === 0}>
          <Plus />
          New project
        </Button>
      </div>

      {projects === null ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading projects…
          </CardContent>
        </Card>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <FolderKanban className="size-8" />
            No projects yet. Start one and the manager will break it into tasks.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              orgSlug={orgSlug}
              project={project}
              agents={agents}
              open={openId === project.id}
              onToggle={() => setOpenId(openId === project.id ? null : project.id)}
              onChanged={load}
            />
          ))}
        </div>
      )}

      {creating && (
        <CreateProjectDialog
          orgSlug={orgSlug}
          agents={agents}
          defaultManagerId={defaultManagerId}
          onClose={(saved) => {
            setCreating(false);
            if (saved) void load();
          }}
        />
      )}
    </>
  );
}

function projectStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge variant="success">completed</Badge>;
    case "in_progress":
      return <Badge variant="warning">in progress</Badge>;
    case "planning":
      return (
        <Badge variant="warning">
          <Loader2 className="animate-spin" />
          planning
        </Badge>
      );
    case "cancelled":
      return <Badge variant="outline">cancelled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function ProjectCard({
  orgSlug,
  project,
  agents,
  open,
  onToggle,
  onChanged,
}: {
  orgSlug: string;
  project: ProjectListItem;
  agents: TaskAgent[];
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<{ tasks: TaskItem[]; summary: string | null } | null>(null);
  const [addingTask, setAddingTask] = useState(false);

  const loadDetail = useCallback(async () => {
    const res = await fetch(`/api/orgs/${orgSlug}/projects/${project.id}`);
    if (res.ok) {
      const body = await res.json();
      setDetail({ tasks: body.tasks, summary: body.project.summary });
    }
  }, [orgSlug, project.id]);

  useEffect(() => {
    if (!open) return;
    void loadDetail();
  }, [open, loadDetail]);

  // Poll detail while the project or any task is active.
  const detailActive =
    project.status === "planning" ||
    project.status === "in_progress" ||
    (detail?.tasks.some((t) => t.status === "pending" || t.status === "in_progress") ?? false);
  useEffect(() => {
    if (!open || !detailActive) return;
    const timer = setInterval(() => {
      void loadDetail();
      onChanged();
    }, 3000);
    return () => clearInterval(timer);
  }, [open, detailActive, loadDetail, onChanged]);

  return (
    <Card>
      <CardHeader>
        <button className="flex items-start gap-3 text-left" onClick={onToggle}>
          <FolderKanban className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate">{project.title}</CardTitle>
            {project.description && <CardDescription className="truncate">{project.description}</CardDescription>}
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              {project.manager && (
                <span className="flex items-center gap-1">
                  <AgentAvatar name={project.manager.name} color={project.manager.avatarColor} size="sm" />
                  {project.manager.name}
                </span>
              )}
              <span>
                {project.doneCount}/{project.taskCount} tasks done
              </span>
            </div>
          </div>
          {projectStatusBadge(project.status)}
        </button>
      </CardHeader>

      {open && (
        <CardContent className="flex flex-col gap-3 border-t pt-4">
          {project.status === "planning" && (
            <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              <Loader2 className="size-4 animate-spin" />
              {project.manager?.name ?? "The manager"} is planning this project into tasks…
            </div>
          )}

          {detail === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <>
              {project.status === "completed" && (project.summary || detail.summary) && (
                <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
                  <div className="pb-1 text-xs font-medium text-muted-foreground">Project summary</div>
                  <Markdown>{project.summary ?? detail.summary ?? ""}</Markdown>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Tasks</span>
                <Button variant="outline" size="sm" onClick={() => setAddingTask(true)}>
                  <Plus />
                  Add task
                </Button>
              </div>

              {detail.tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {detail.tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      feedbackUrl={`/api/orgs/${orgSlug}/tasks/${task.id}/feedback`}
                      onChanged={() => {
                        void loadDetail();
                        onChanged();
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {addingTask && (
            <AddTaskDialog
              orgSlug={orgSlug}
              projectId={project.id}
              agents={agents}
              defaultAgentId={project.manager?.id ?? null}
              onClose={(saved) => {
                setAddingTask(false);
                if (saved) {
                  void loadDetail();
                  onChanged();
                }
              }}
            />
          )}
        </CardContent>
      )}
    </Card>
  );
}

function CreateProjectDialog({
  orgSlug,
  agents,
  defaultManagerId,
  onClose,
}: {
  orgSlug: string;
  agents: TaskAgent[];
  defaultManagerId: string | null;
  onClose: (saved: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [managerAgentId, setManagerAgentId] = useState(defaultManagerId ?? agents[0]?.id ?? "");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await fetch(`/api/orgs/${orgSlug}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: description || undefined, managerAgentId }),
    });
    const body = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not create project");
      return;
    }
    toast.success("Project created — the manager is planning it into tasks");
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            A bigger initiative. The project manager plans it into tasks and delivers each through the org.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-title">Title</Label>
            <Input
              id="project-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Launch LoomWidget 2.0"
              required
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-desc">Details</Label>
            <Textarea
              id="project-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Goals, scope, constraints, deadlines…"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Project manager</Label>
            <Select value={managerAgentId} onValueChange={setManagerAgentId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a manager" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    <span className="flex items-center gap-2">
                      <AgentAvatar name={agent.name} color={agent.avatarColor} size="sm" />
                      {agent.name} — {agent.title}
                      {agent.id === defaultManagerId && <span className="text-xs text-muted-foreground">(CEO)</span>}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !managerAgentId}>
              {pending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddTaskDialog({
  orgSlug,
  projectId,
  agents,
  defaultAgentId,
  onClose,
}: {
  orgSlug: string;
  projectId: string;
  agents: TaskAgent[];
  defaultAgentId: string | null;
  onClose: (saved: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coordinatorAgentId, setCoordinatorAgentId] = useState(defaultAgentId ?? agents[0]?.id ?? "");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await fetch(`/api/orgs/${orgSlug}/projects/${projectId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: description || undefined, coordinatorAgentId }),
    });
    const body = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not add task");
      return;
    }
    toast.success("Task added to the project");
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add task to project</DialogTitle>
          <DialogDescription>A task the project needs, assigned to an AI employee.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="pt-title">Title</Label>
            <Input id="pt-title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pt-desc">Details</Label>
            <Textarea id="pt-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
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
              {pending ? "Adding…" : "Add task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
