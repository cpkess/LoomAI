"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUp, Loader2, RefreshCw, Rocket, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/chat/markdown";
import { Textarea } from "@/components/ui/textarea";
import { KIND_LABELS } from "@/lib/projects/deliverableKinds";

export interface Charter {
  objective: string;
  successCriteria: string[];
  scope: { inScope: string[]; outOfScope: string[] };
  audience: string;
  keyQuestions: string[];
  assumptions: string[];
  risks: string[];
  approach: string[];
  deliverables: { title: string; kind: string; brief: string }[];
  evidenceNeeded: string[];
}

type ChatMessage = UIMessage;

export function ProjectScoping({ orgSlug, projectId, onFinalized }: { orgSlug: string; projectId: string; onFinalized: () => void }) {
  const base = `/api/orgs/${orgSlug}/projects/${projectId}/scoping`;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [initial, setInitial] = useState<ChatMessage[]>([]);
  const [charter, setCharter] = useState<Charter | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadState = useCallback(async () => {
    const res = await fetch(base);
    if (!res.ok) return;
    const data = await res.json();
    setConversationId(data.conversationId);
    setCharter(data.charter);
    setInitial(
      (data.messages as { id: string; role: string; content: string }[])
        .filter((m) => m.role !== "system")
        .map((m) => ({ id: m.id, role: m.role as "user" | "assistant", parts: [{ type: "text" as const, text: m.content }] }))
    );
    setLoading(false);
  }, [base]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const refreshCharter = useCallback(async () => {
    const res = await fetch(base);
    if (res.ok) setCharter((await res.json()).charter);
  }, [base]);

  async function redraft() {
    setBusy(true);
    const res = await fetch(`${base}/draft`, { method: "POST" });
    setBusy(false);
    if (res.ok) setCharter((await res.json()).charter);
    else toast.error("Could not refresh the plan");
  }

  async function startProject() {
    if (!charter) return;
    setBusy(true);
    const res = await fetch(`${base}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ charter }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error("Could not start the project");
      return;
    }
    toast.success("Work plan set — the project is live");
    onFinalized();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Drafting your work plan…
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Card className="flex min-h-[30rem] flex-col">
        <CardHeader className="border-b">
          <CardTitle className="text-base">Scoping</CardTitle>
          <p className="text-xs text-muted-foreground">
            Refine the plan with the strategist. Answer its questions, or just tell it what you want.
          </p>
        </CardHeader>
        {conversationId && (
          <ScopingThread base={base} conversationId={conversationId} initialMessages={initial} onAssistantDone={refreshCharter} />
        )}
      </Card>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Work plan</h3>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={redraft} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
          <Button size="sm" onClick={startProject} disabled={busy || !charter?.objective}>
            <Rocket />
            Start project
          </Button>
        </div>
        <PlanPanel charter={charter} />
      </div>
    </div>
  );
}

function ScopingThread({
  base,
  conversationId,
  initialMessages,
  onAssistantDone,
}: {
  base: string;
  conversationId: string;
  initialMessages: ChatMessage[];
  onAssistantDone: () => void;
}) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, stop } = useChat<ChatMessage>({
    id: conversationId,
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: `${base}/message`, body: { conversationId } }),
    onFinish: () => onAssistantDone(),
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  const working = status === "submitted" || status === "streaming";

  function submit() {
    const text = input.trim();
    if (!text || working) return;
    setInput("");
    void sendMessage({ text });
  }

  return (
    <>
      <CardContent className="flex-1 overflow-y-auto pt-4">
        <div className="flex flex-col gap-4">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              I&apos;ve drafted a plan on the right from your brief. Tell me what to change, or answer the questions to sharpen it.
            </p>
          )}
          {messages.map((m) => {
            const text = m.parts
              .filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join("");
            return (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {m.role === "assistant" ? <Markdown>{text}</Markdown> : <div className="whitespace-pre-wrap">{text}</div>}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </CardContent>
      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="e.g. narrow this to the German market, and add an exec summary deck"
            className="min-h-10 max-h-40 resize-none"
            rows={1}
          />
          {working ? (
            <Button size="icon" variant="outline" onClick={() => stop()}>
              <Square className="size-4" />
            </Button>
          ) : (
            <Button size="icon" onClick={submit} disabled={!input.trim()}>
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <ul className="mt-1 flex flex-col gap-1 text-sm">
        {items.map((i, idx) => (
          <li key={idx}>• {i}</li>
        ))}
      </ul>
    </div>
  );
}

export function PlanPanel({ charter, hideDeliverables }: { charter: Charter | null; hideDeliverables?: boolean }) {
  if (!charter) return <p className="text-sm text-muted-foreground">No plan yet.</p>;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-4">
        {charter.objective && (
          <div>
            <div className="text-xs font-medium text-muted-foreground">Objective</div>
            <p className="mt-1 text-sm font-medium">{charter.objective}</p>
          </div>
        )}
        <List title="Success criteria" items={charter.successCriteria} />
        {charter.audience && (
          <div>
            <div className="text-xs font-medium text-muted-foreground">Audience</div>
            <p className="mt-1 text-sm">{charter.audience}</p>
          </div>
        )}
        <List title="In scope" items={charter.scope?.inScope ?? []} />
        <List title="Out of scope" items={charter.scope?.outOfScope ?? []} />
        <List title="Key questions" items={charter.keyQuestions} />
        <List title="Assumptions" items={charter.assumptions} />
        <List title="Risks" items={charter.risks} />
        <List title="Approach" items={charter.approach} />
        <List title="Evidence to gather" items={charter.evidenceNeeded} />
        {!hideDeliverables && charter.deliverables?.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground">Planned deliverables</div>
            <ul className="mt-1 flex flex-col gap-1.5 text-sm">
              {charter.deliverables.map((d, idx) => (
                <li key={idx} className="rounded-md border px-2 py-1.5">
                  <span className="font-medium">{d.title}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {KIND_LABELS[d.kind as keyof typeof KIND_LABELS] ?? d.kind}
                  </span>
                  {d.brief && <div className="text-xs text-muted-foreground">{d.brief}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
