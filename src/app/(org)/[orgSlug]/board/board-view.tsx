"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Gavel, Inbox, Lightbulb, Loader2, Mail, MailOpen, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Markdown } from "@/components/chat/markdown";
import { OutputActions } from "@/components/output/output-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ActionItem {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  summary: string;
  result: string | null;
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
  proposedBy: { kind: "agent" | "human"; name: string; title: string | null; avatarColor: string | null } | null;
  decidedBy: string | null;
}

interface EmailItem {
  id: string;
  taskId: string | null;
  fromName: string;
  subject: string;
  body: string;
  outcome: string;
  read: boolean;
  createdAt: string;
}

/** Recommendations are Board proposals whose type is prefixed `recommend_`. */
function isRec(type: string): boolean {
  return type.startsWith("recommend_");
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "executed":
      return <Badge variant="success">executed</Badge>;
    case "rejected":
      return <Badge variant="outline">rejected</Badge>;
    case "failed":
      return <Badge variant="destructive">failed</Badge>;
    default:
      return <Badge variant="warning">awaiting approval</Badge>;
  }
}

export function BoardView({ orgSlug, isBoardMember }: { orgSlug: string; isBoardMember: boolean }) {
  const router = useRouter();
  const [actions, setActions] = useState<ActionItem[] | null>(null);
  const [emails, setEmails] = useState<EmailItem[] | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const load = useCallback(async () => {
    const [aRes, eRes] = await Promise.all([
      fetch(`/api/orgs/${orgSlug}/actions`),
      fetch(`/api/orgs/${orgSlug}/emails`),
    ]);
    if (aRes.ok) setActions((await aRes.json()).actions);
    if (eRes.ok) setEmails((await eRes.json()).emails);
  }, [orgSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(action: ActionItem, approve: boolean) {
    setDeciding(action.id);
    const res = await fetch(`/api/orgs/${orgSlug}/actions/${action.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve }),
    });
    const body = await res.json().catch(() => ({}));
    setDeciding(null);
    if (!res.ok) {
      toast.error(body.error ?? "Could not record the decision");
      return;
    }
    const decided = body.action as { status: string; result?: string; error?: string };
    if (approve) {
      if (decided.status === "executed") toast.success(`Approved and executed: ${decided.result ?? action.summary}`);
      else toast.error(`Approved, but execution failed: ${decided.error}`);
    } else {
      toast.success("Proposal rejected");
    }
    void load();
    router.refresh();
  }

  async function suggest() {
    setSuggesting(true);
    const res = await fetch(`/api/orgs/${orgSlug}/recommendations/generate`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setSuggesting(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not generate recommendations");
      return;
    }
    if (!body.learnedEnough) {
      toast.info("Recommendations unlock as your company's knowledge base grows. Keep working — and add knowledge.");
      return;
    }
    if ((body.created ?? 0) === 0) {
      toast.info("No new recommendations right now — review the pending ones first.");
      return;
    }
    toast.success(`${body.created} new recommendation${body.created === 1 ? "" : "s"} from your CEO`);
    void load();
  }

  const pending = actions?.filter((a) => a.status === "pending_approval") ?? [];
  const history = actions?.filter((a) => a.status !== "pending_approval") ?? [];
  const unread = emails?.filter((e) => !e.read).length ?? 0;

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Board room</h1>
        <p className="text-sm text-muted-foreground">
          Your AI employees email their finished task outputs here, route policy-gated actions to you for approval, and —
          once the company has learned enough — propose new projects and deliverables for you to greenlight.
        </p>
      </div>

      {actions === null || emails === null ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="inbox">
          <TabsList>
            <TabsTrigger value="inbox">
              <Inbox className="size-4" />
              Inbox
              {unread > 0 && <Badge variant="warning">{unread}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="approvals">
              <Gavel className="size-4" />
              Approvals
              {pending.length > 0 && <Badge variant="warning">{pending.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="inbox" className="flex flex-col gap-3 pt-3">
            {emails.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                  <Inbox className="size-6" />
                  No mail yet. When a delegated task finishes, its coordinator emails the final output here.
                </CardContent>
              </Card>
            ) : (
              emails.map((email) => <EmailCard key={email.id} orgSlug={orgSlug} email={email} onChanged={load} />)
            )}
          </TabsContent>

          <TabsContent value="approvals" className="flex flex-col gap-4 pt-3">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-muted-foreground">
                  Awaiting approval {pending.length > 0 && <Badge variant="warning">{pending.length}</Badge>}
                </h2>
                {isBoardMember && (
                  <Button size="sm" variant="outline" disabled={suggesting} onClick={suggest}>
                    {suggesting ? <Loader2 className="animate-spin" /> : <Lightbulb />}
                    Suggest next steps
                  </Button>
                )}
              </div>
              {pending.length === 0 && (
                <Card>
                  <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                    <Gavel className="size-6" />
                    Nothing awaiting the Board. The company is running itself.
                  </CardContent>
                </Card>
              )}
              {pending.map((action) => (
                <Card key={action.id} className="py-4">
                  <CardContent className="flex flex-col gap-3 px-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {action.proposedBy?.kind === "agent" && (
                          <AgentAvatar name={action.proposedBy.name} color={action.proposedBy.avatarColor} />
                        )}
                        <div>
                          <div className="font-medium">{action.summary}</div>
                          <div className="text-xs text-muted-foreground">
                            Proposed by {action.proposedBy?.name ?? "unknown"}
                            {action.proposedBy?.title ? ` (${action.proposedBy.title})` : ""} ·{" "}
                            {new Date(action.createdAt).toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <StatusBadge status={action.status} />
                    </div>
                    {isRec(action.type) ? (
                      <div className="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                        {typeof action.payload.description === "string" && (
                          <p className="whitespace-pre-wrap">{action.payload.description}</p>
                        )}
                        {typeof action.payload.rationale === "string" && action.payload.rationale && (
                          <p className="text-xs text-muted-foreground">
                            <span className="font-medium">Why: </span>
                            {action.payload.rationale}
                          </p>
                        )}
                      </div>
                    ) : (
                      <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-xs">
                        {JSON.stringify(action.payload, null, 2)}
                      </pre>
                    )}
                    {isBoardMember ? (
                      <div className="flex gap-2">
                        <Button size="sm" disabled={deciding === action.id} onClick={() => decide(action, true)}>
                          <Check />
                          {isRec(action.type) ? "Approve & start" : "Approve & execute"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={deciding === action.id}
                          onClick={() => decide(action, false)}
                        >
                          <X />
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Only Board members (organization admins) can decide.</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Decision log</CardTitle>
                <CardDescription>Every company action — autonomous and Board-approved — is recorded here.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {history.length === 0 && <p className="text-sm text-muted-foreground">No actions yet.</p>}
                {history.map((action) => (
                  <div key={action.id} className="flex items-center gap-3 rounded-md border p-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{action.summary}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {action.proposedBy?.name ?? "unknown"} · {new Date(action.createdAt).toLocaleString()}
                        {action.decidedBy && ` · decided by ${action.decidedBy}`}
                        {action.result && ` · ${action.result}`}
                        {action.error && ` · ${action.error}`}
                      </div>
                    </div>
                    <StatusBadge status={action.status} />
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

function EmailCard({ orgSlug, email, onChanged }: { orgSlug: string; email: EmailItem; onChanged: () => void }) {
  const [open, setOpen] = useState(false);

  async function setRead(read: boolean) {
    await fetch(`/api/orgs/${orgSlug}/emails/${email.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read }),
    });
    onChanged();
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !email.read) void setRead(true);
  }

  return (
    <Card className={cn("py-4", !email.read && "border-primary/40")}>
      <CardContent className="flex flex-col gap-3 px-4">
        <button className="flex items-start gap-3 text-left" onClick={toggle}>
          <div className="mt-0.5 text-muted-foreground">
            {email.read ? <MailOpen className="size-4" /> : <Mail className="size-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className={cn("truncate", email.read ? "font-medium" : "font-semibold")}>{email.subject}</div>
            <div className="truncate text-xs text-muted-foreground">
              From {email.fromName} · {new Date(email.createdAt).toLocaleString()}
            </div>
          </div>
          <Badge
            variant={
              email.outcome === "completed" ? "success" : email.outcome === "review" ? "warning" : "destructive"
            }
          >
            {email.outcome === "review" ? "review" : email.outcome}
          </Badge>
        </button>
        {open && (
          <div className="min-w-0 overflow-hidden border-t pt-3">
            <div className="flex items-center justify-between gap-2 pb-2">
              <span className="text-xs font-medium text-muted-foreground">Message</span>
              <div className="flex items-center gap-1">
                <OutputActions text={email.body} defaultTitle={email.subject} />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={() => setRead(!email.read)}
                >
                  {email.read ? "Mark unread" : "Mark read"}
                </Button>
              </div>
            </div>
            <Markdown>{email.body}</Markdown>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
