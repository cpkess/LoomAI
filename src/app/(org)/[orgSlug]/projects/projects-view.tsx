"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FolderKanban, Gavel, GitBranch, Loader2, Milestone, MessageSquareReply, Plus } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Markdown } from "@/components/chat/markdown";
import { OutputActions } from "@/components/output/output-actions";
import { TaskCard, type TaskAgent, type TaskItem } from "@/components/tasks/task-card";
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
  stageCount: number;
  stageDoneCount: number;
  awaitingReview: boolean;
}

interface Milestone {
  id: string;
  title: string;
  description: string | null;
  gate: "auto" | "review";
  status: string;
  summary: string | null;
  reviewFeedback: string | null;
  orderIndex: number;
  isBranch: boolean;
  tasks: TaskItem[];
}

interface ProjectDetail {
  stages: Milestone[];
  ungrouped: TaskItem[];
  summary: string | null;
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
            Bigger, longer initiatives. A manager plans a project into <strong>milestones</strong>; each milestone runs
            as tasks and, at a <strong>review gate</strong>, pauses for the Board to approve or request changes.
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
            No projects yet. Start one and the manager will break it into milestones.
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
    case "awaiting_review":
      return (
        <Badge variant="warning">
          <Gavel className="size-3" />
          needs review
        </Badge>
      );
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
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [addingTask, setAddingTask] = useState(false);

  const loadDetail = useCallback(async () => {
    const res = await fetch(`/api/orgs/${orgSlug}/projects/${project.id}`);
    if (res.ok) {
      const body = await res.json();
      setDetail({ stages: body.stages, ungrouped: body.ungrouped, summary: body.project.summary });
    }
  }, [orgSlug, project.id]);

  useEffect(() => {
    if (!open) return;
    void loadDetail();
  }, [open, loadDetail]);

  // Poll detail while the project or any task is active (but not while a review
  // gate is waiting on the Board — nothing changes until they act).
  const detailActive =
    project.status === "planning" ||
    project.status === "in_progress" ||
    (detail?.stages.some((s) => s.tasks.some((t) => t.status === "pending" || t.status === "in_progress")) ?? false);
  useEffect(() => {
    if (!open || !detailActive) return;
    const timer = setInterval(() => {
      void loadDetail();
      onChanged();
    }, 3000);
    return () => clearInterval(timer);
  }, [open, detailActive, loadDetail, onChanged]);

  const progressLabel =
    project.stageCount > 0
      ? `${project.stageDoneCount}/${project.stageCount} milestones`
      : `${project.doneCount}/${project.taskCount} tasks`;

  return (
    <Card>
      <CardHeader>
        <button className="flex items-start gap-3 text-left" onClick={onToggle}>
          <FolderKanban className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate">{project.title}</CardTitle>
            {project.description && <CardDescription className="truncate">{project.description}</CardDescription>}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {project.manager && (
                <span className="flex items-center gap-1">
                  <AgentAvatar name={project.manager.name} color={project.manager.avatarColor} size="sm" />
                  {project.manager.name}
                </span>
              )}
              <span>{progressLabel}</span>
              {project.awaitingReview && (
                <Badge variant="warning" className="text-[10px]">
                  <Gavel className="size-3" />
                  review needed
                </Badge>
              )}
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
              {project.manager?.name ?? "The manager"} is planning this project into milestones…
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
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <OutputActions text={project.summary ?? detail.summary ?? ""} defaultTitle={project.title} />
                    <MilestoneFeedback
                      orgSlug={orgSlug}
                      projectId={project.id}
                      label="Give project feedback"
                      onChanged={() => {
                        void loadDetail();
                        onChanged();
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Milestones</span>
                <Button variant="outline" size="sm" onClick={() => setAddingTask(true)}>
                  <Plus />
                  Add task
                </Button>
              </div>

              {detail.stages.length === 0 && detail.ungrouped.length === 0 ? (
                <p className="text-sm text-muted-foreground">No milestones yet.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {detail.stages.map((stage, i) => (
                    <MilestoneCard
                      key={stage.id}
                      orgSlug={orgSlug}
                      projectId={project.id}
                      stage={stage}
                      index={i}
                      onChanged={() => {
                        void loadDetail();
                        onChanged();
                      }}
                    />
                  ))}

                  {detail.ungrouped.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Other tasks</span>
                      {detail.ungrouped.map((task) => (
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

function stageStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <Badge variant="success">
          <CheckCircle2 className="size-3" />
          done
        </Badge>
      );
    case "awaiting_review":
      return (
        <Badge variant="warning">
          <Gavel className="size-3" />
          needs review
        </Badge>
      );
    case "in_progress":
      return (
        <Badge variant="warning">
          <Loader2 className="size-3 animate-spin" />
          working
        </Badge>
      );
    case "skipped":
      return <Badge variant="outline">skipped</Badge>;
    default:
      return <Badge variant="outline">queued</Badge>;
  }
}

function MilestoneCard({
  orgSlug,
  projectId,
  stage,
  index,
  onChanged,
}: {
  orgSlug: string;
  projectId: string;
  stage: Milestone;
  index: number;
  onChanged: () => void;
}) {
  const completed = stage.status === "completed";
  return (
    <div className={cn("rounded-lg border bg-muted/20", stage.isBranch && "border-primary/40 bg-primary/5")}>
      <div className="flex items-start gap-3 p-3">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-background text-xs font-semibold text-muted-foreground ring-1 ring-border">
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {stage.isBranch ? (
              <GitBranch className="size-4 shrink-0 text-primary" />
            ) : (
              <Milestone className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="font-medium">{stage.title}</span>
            {stage.isBranch && (
              <Badge variant="secondary" className="text-[10px]">
                <GitBranch className="size-3" />
                feedback branch
              </Badge>
            )}
            {stage.gate === "review" ? (
              <Badge variant="outline" className="text-[10px]">
                <Gavel className="size-3" />
                review gate
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">
                auto
              </Badge>
            )}
            <span className="ml-auto">{stageStatusBadge(stage.status)}</span>
          </div>
          {stage.description && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{stage.description}</p>}
        </div>
      </div>

      <div className="flex flex-col gap-2 px-3 pb-3">
        {stage.summary && stage.status !== "in_progress" && (
          <div className="rounded-md border bg-background/60 p-2.5 text-sm">
            <div className="pb-1 text-xs font-medium text-muted-foreground">Milestone deliverable</div>
            <Markdown>{stage.summary}</Markdown>
            <OutputActions className="mt-2" text={stage.summary} defaultTitle={stage.title} />
          </div>
        )}

        {stage.reviewFeedback && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm">
            <div className="pb-1 text-xs font-medium text-muted-foreground">Board feedback</div>
            <p className="whitespace-pre-wrap">{stage.reviewFeedback}</p>
          </div>
        )}

        {stage.status === "awaiting_review" && (
          <StageReview orgSlug={orgSlug} projectId={projectId} stageId={stage.id} onChanged={onChanged} />
        )}

        {stage.tasks.length > 0 && (
          <div className="flex flex-col gap-2">
            {stage.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                feedbackUrl={`/api/orgs/${orgSlug}/tasks/${task.id}/feedback`}
                onChanged={onChanged}
                allowFeedback={false}
              />
            ))}
          </div>
        )}

        {completed && (
          <MilestoneFeedback orgSlug={orgSlug} projectId={projectId} stageId={stage.id} onChanged={onChanged} />
        )}
      </div>
    </div>
  );
}

/** Give feedback on a completed milestone or project — creates a new branch step to address it. */
function MilestoneFeedback({
  orgSlug,
  projectId,
  stageId,
  label = "Request a change",
  onChanged,
}: {
  orgSlug: string;
  projectId: string;
  stageId?: string;
  label?: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!message.trim()) return;
    setPending(true);
    const res = await fetch(`/api/orgs/${orgSlug}/projects/${projectId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message.trim(), ...(stageId ? { afterStageId: stageId } : {}) }),
    });
    const body = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not submit feedback");
      return;
    }
    toast.success("Added a revision branch to address your feedback");
    setMessage("");
    setOpen(false);
    onChanged();
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)}>
        <MessageSquareReply />
        {label}
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="text-xs font-medium text-muted-foreground">
        Your feedback becomes a new branch milestone that addresses it and comes back for your review.
      </div>
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        placeholder="e.g. Add a rollback plan and tighten the cost estimates."
        autoFocus
      />
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !message.trim()} onClick={() => void submit()}>
          <GitBranch />
          {pending ? "Adding…" : "Create branch step"}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function StageReview({
  orgSlug,
  projectId,
  stageId,
  onChanged,
}: {
  orgSlug: string;
  projectId: string;
  stageId: string;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "changes">("idle");
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(decision: "approve" | "request_changes") {
    if (decision === "request_changes" && !feedback.trim()) {
      toast.error("Describe the changes you'd like");
      return;
    }
    setPending(true);
    const res = await fetch(`/api/orgs/${orgSlug}/projects/${projectId}/stages/${stageId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, feedback: feedback.trim() || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not submit review");
      return;
    }
    toast.success(decision === "approve" ? "Milestone approved — moving on" : "Added a revision branch to address your changes");
    setMode("idle");
    setFeedback("");
    onChanged();
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-warning">
        <Gavel className="size-4" />
        This milestone is waiting for your review
      </div>
      {mode === "idle" ? (
        <div className="flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => submit("approve")}>
            <CheckCircle2 />
            Approve &amp; continue
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setMode("changes")}>
            Request changes
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            placeholder="What should change before this milestone is approved?"
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={() => submit("request_changes")}>
              Send back for changes
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
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
    toast.success("Project created — the manager is planning it into milestones");
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            A bigger initiative. The manager plans it into milestones and delivers each through the org — pausing at
            review gates for your feedback.
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
          <DialogDescription>
            A task the project needs, added to the current milestone (or a new follow-up milestone if the project has
            finished).
          </DialogDescription>
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
