"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileCheck,
  ListChecks,
  Loader2,
  MessageSquareReply,
  Send,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Markdown } from "@/components/chat/markdown";
import { OutputActions } from "@/components/output/output-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export interface TaskAgent {
  id: string;
  name: string;
  title: string;
  avatarColor: string | null;
}

export interface TaskUpdateItem {
  id: string;
  kind: "result" | "feedback" | "plan" | "subtask_result";
  content: string;
  author: string | null;
  createdAt: string;
}

export interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  result: string | null;
  error: string | null;
  agent: TaskAgent | null;
  subtasks?: TaskItem[];
  updates?: TaskUpdateItem[];
}

export function StatusBadge({ status }: { status: string }) {
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

export function TaskCard({
  task,
  feedbackUrl,
  onChanged,
  defaultOpen = false,
  allowFeedback = true,
}: {
  task: TaskItem;
  /** Endpoint the "Send feedback & revise" button POSTs { message } to. */
  feedbackUrl: string;
  onChanged: () => void;
  defaultOpen?: boolean;
  /** Show the per-task feedback box (off in projects, where feedback is per-milestone). */
  allowFeedback?: boolean;
}) {
  const updates = task.updates ?? [];
  const [open, setOpen] = useState(defaultOpen);
  const [feedback, setFeedback] = useState("");
  const [sending, setSending] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

  const hasDetail = updates.length > 0 || Boolean(task.result || task.error);
  const working = justSubmitted || task.status === "in_progress" || task.status === "pending";
  const finished = task.status === "completed" || task.status === "failed";

  useEffect(() => {
    if (task.status === "in_progress" || task.status === "pending") setJustSubmitted(false);
  }, [task.status]);
  const prevResult = useRef(task.result);
  useEffect(() => {
    if (task.result !== prevResult.current) {
      prevResult.current = task.result;
      setJustSubmitted(false);
    }
  }, [task.result]);

  const lastResultIndex = (() => {
    for (let i = updates.length - 1; i >= 0; i--) if (updates[i].kind === "result") return i;
    return -1;
  })();

  async function sendFeedback() {
    const message = feedback.trim();
    if (!message) return;
    setSending(true);
    const res = await fetch(feedbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const body = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not send feedback");
      return;
    }
    setFeedback("");
    setJustSubmitted(true);
    setOpen(true);
    toast.success(`Feedback sent — ${task.agent?.name ?? "the coordinator"} is reworking it`);
    onChanged();
  }

  return (
    <Card className={cn("py-4", working && "border-warning/40")}>
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
          <StatusBadge status={working ? "in_progress" : task.status} />
        </button>

        {open && (
          <div className="flex min-w-0 flex-col gap-4 overflow-hidden border-t pt-4">
            {working && (
              <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                <Loader2 className="size-4 animate-spin" />
                {task.agent?.name ?? "The coordinator"} is working on this…
              </div>
            )}

            {updates.length === 0 && !working && (
              <p className="text-sm text-muted-foreground">No activity recorded.</p>
            )}

            {updates.length > 0 && (
              <ol className="flex flex-col">
                {updates.map((update, i) => (
                  <TimelineEntry
                    key={update.id}
                    update={update}
                    agent={task.agent}
                    taskTitle={task.title}
                    isFinalResult={i === lastResultIndex}
                    isLast={i === updates.length - 1}
                  />
                ))}
              </ol>
            )}

            {task.error && (
              <div className="break-words rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {task.error}
              </div>
            )}

            {allowFeedback && finished && !working && (
              <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
                <div className="text-xs font-medium text-muted-foreground">
                  Not quite right? Reply to {task.agent?.name ?? "the coordinator"} and they&apos;ll revise the result.
                </div>
                <Textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={2}
                  placeholder='e.g. "Add a section on rollout risks and tighten the summary."'
                />
                <Button
                  size="sm"
                  className="self-start"
                  disabled={sending || !feedback.trim()}
                  onClick={() => void sendFeedback()}
                >
                  <Send />
                  {sending ? "Sending…" : "Send feedback & revise"}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const STEP_META: Record<
  TaskUpdateItem["kind"],
  { label: (final: boolean) => string; icon: typeof ListChecks; tone: string }
> = {
  plan: { label: () => "Planned the work", icon: ListChecks, tone: "text-indigo-500" },
  subtask_result: { label: () => "Subtask completed", icon: Users, tone: "text-sky-500" },
  result: { label: (final) => (final ? "Final result" : "Draft result"), icon: FileCheck, tone: "text-emerald-500" },
  feedback: { label: () => "Your feedback", icon: MessageSquareReply, tone: "text-primary" },
};

function TimelineEntry({
  update,
  agent,
  taskTitle,
  isFinalResult,
  isLast,
}: {
  update: TaskUpdateItem;
  agent: TaskAgent | null;
  taskTitle: string;
  isFinalResult: boolean;
  isLast: boolean;
}) {
  const meta = STEP_META[update.kind];
  const Icon = meta.icon;
  const isFeedback = update.kind === "feedback";
  const isResultLike = update.kind === "result" || update.kind === "subtask_result";

  let heading = meta.label(isFinalResult);
  let byline: string | null = null;
  let body = update.content;
  if (update.kind === "subtask_result") {
    const nl = update.content.indexOf("\n");
    if (nl > 0) {
      heading = update.content.slice(0, nl).replace(/:$/, "");
      body = update.content.slice(nl + 1);
    }
  } else if (update.kind === "result") {
    byline = agent ? `${agent.name}${isFinalResult ? "" : " · superseded by feedback below"}` : null;
  } else if (isFeedback) {
    byline = update.author ?? "You";
  }

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full border bg-background",
            meta.tone
          )}
        >
          <Icon className="size-3.5" />
        </div>
        {!isLast && <div className="w-px flex-1 bg-border" />}
      </div>

      <div className={cn("min-w-0 flex-1", isLast ? "pb-1" : "pb-5")}>
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-sm font-semibold">{heading}</div>
          <div className="shrink-0 text-xs text-muted-foreground">{new Date(update.createdAt).toLocaleString()}</div>
        </div>
        {byline && <div className="text-xs text-muted-foreground">{byline}</div>}

        <div
          className={cn(
            "mt-2 min-w-0 overflow-hidden rounded-md border p-3 text-sm",
            isFeedback && "border-primary/30 bg-primary/5",
            isFinalResult && "border-emerald-500/40 bg-emerald-500/5",
            !isFeedback && !isFinalResult && "bg-muted/20"
          )}
        >
          {isFinalResult && (
            <div className="mb-2 flex items-center justify-between gap-2">
              <Badge variant="success">Deliverable</Badge>
              <OutputActions text={body} defaultTitle={taskTitle} />
            </div>
          )}
          {isFeedback ? (
            <p className="whitespace-pre-wrap break-words">{body}</p>
          ) : (
            <Markdown>{body}</Markdown>
          )}
          {isResultLike && !isFinalResult && (
            <OutputActions text={body} defaultTitle={taskTitle} className="pt-1" />
          )}
        </div>
      </div>
    </li>
  );
}
