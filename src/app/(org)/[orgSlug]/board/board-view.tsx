"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Gavel, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
  const [deciding, setDeciding] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orgs/${orgSlug}/actions`);
    if (res.ok) setActions((await res.json()).actions);
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

  const pending = actions?.filter((a) => a.status === "pending_approval") ?? [];
  const history = actions?.filter((a) => a.status !== "pending_approval") ?? [];

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Board room</h1>
        <p className="text-sm text-muted-foreground">
          Proposals from your AI employees that company policy routes through the Board. Approving a proposal
          executes it immediately; everything else in the company runs autonomously.
        </p>
      </div>

      {actions === null ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Awaiting approval {pending.length > 0 && <Badge variant="warning">{pending.length}</Badge>}
            </h2>
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
                  <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-xs">
                    {JSON.stringify(action.payload, null, 2)}
                  </pre>
                  {isBoardMember ? (
                    <div className="flex gap-2">
                      <Button size="sm" disabled={deciding === action.id} onClick={() => decide(action, true)}>
                        <Check />
                        Approve &amp; execute
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
        </>
      )}
    </>
  );
}
