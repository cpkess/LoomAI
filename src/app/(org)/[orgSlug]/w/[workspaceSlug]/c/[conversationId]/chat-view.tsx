"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUp, CircleAlert, FileText, Square, User, Wrench } from "lucide-react";

import type { MessageAction, MessageSource } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/chat/markdown";
import { Textarea } from "@/components/ui/textarea";

interface InitialMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  sources?: MessageSource[];
  actions?: MessageAction[];
}

type ChatMessage = UIMessage<{ sources?: MessageSource[]; actions?: MessageAction[] }>;

function toUIMessages(initial: InitialMessage[]): ChatMessage[] {
  return initial
    .filter((m) => m.role !== "system")
    .map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      parts: [{ type: "text" as const, text: m.content }],
      metadata: m.sources || m.actions ? { sources: m.sources, actions: m.actions } : undefined,
    }));
}

export function ChatView({
  conversationId,
  title,
  agent,
  initialMessages,
}: {
  conversationId: string;
  title: string;
  agent: { name: string; title: string; avatarColor: string | null } | null;
  initialMessages: InitialMessage[];
}) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, stop } = useChat<ChatMessage>({
    id: conversationId,
    messages: toUIMessages(initialMessages),
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { conversationId },
    }),
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        {agent ? (
          <>
            <AgentAvatar name={agent.name} color={agent.avatarColor} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{agent.name}</div>
              <div className="truncate text-xs text-muted-foreground">{agent.title}</div>
            </div>
          </>
        ) : (
          <div className="truncate text-sm font-semibold">{title}</div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
          {messages.length === 0 && (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {agent
                ? `Say hello to ${agent.name} — your department's ${agent.title}.`
                : "Send a message to get started."}
            </div>
          )}
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} agent={agent} />
          ))}
          {status === "submitted" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="size-2 animate-pulse rounded-full bg-muted-foreground" />
              {agent ? `${agent.name} is thinking…` : "Thinking…"}
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              {error.message}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={agent ? `Message ${agent.name}…` : "Send a message…"}
            className="max-h-40 min-h-11 flex-1 resize-none"
            rows={1}
            autoFocus
          />
          {busy ? (
            <Button size="icon" variant="outline" onClick={() => stop()} aria-label="Stop">
              <Square />
            </Button>
          ) : (
            <Button size="icon" onClick={submit} disabled={!input.trim()} aria-label="Send">
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  agent,
}: {
  message: ChatMessage;
  agent: { name: string; title: string; avatarColor: string | null } | null;
}) {
  const isUser = message.role === "user";
  const text = message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
  const sources = message.metadata?.sources;
  const actions = message.metadata?.actions;
  // Live tool activity while the agent is working (before metadata arrives)
  const liveTools = message.parts
    .filter((p) => typeof p.type === "string" && (p.type.startsWith("tool-") || p.type === "dynamic-tool"))
    .map((p) => p as unknown as { type: string; state?: string; toolName?: string });

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      {isUser ? (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
          <User className="size-4" />
        </div>
      ) : agent ? (
        <AgentAvatar name={agent.name} color={agent.avatarColor} />
      ) : (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
          AI
        </div>
      )}
      <div className={cn("flex min-w-0 max-w-[85%] flex-col gap-2", isUser && "items-end")}>
        {!isUser && liveTools.length > 0 && !actions && (
          <div className="flex flex-wrap gap-1">
            {liveTools.map((part, i) => {
              const name = part.type === "dynamic-tool" ? (part.toolName ?? "tool") : part.type.slice(5);
              const done = part.state === "output-available";
              return (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  <Wrench className="size-3" />
                  {name}
                  {!done && <span className="animate-pulse">…</span>}
                </span>
              );
            })}
          </div>
        )}
        {(text || liveTools.length === 0) && (
          <div
            className={cn(
              "min-w-0 max-w-full overflow-hidden rounded-lg px-3 py-2 text-sm",
              isUser ? "bg-primary text-primary-foreground" : "bg-muted/60"
            )}
          >
            {isUser ? <p className="whitespace-pre-wrap break-words">{text}</p> : <Markdown>{text}</Markdown>}
          </div>
        )}
        {actions && actions.length > 0 && (
          <div className="flex flex-col gap-1">
            {actions.map((action, i) => (
              <span
                key={i}
                className={cn(
                  "inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                  action.status === "executed" && "border-success/40 bg-success/10 text-success",
                  action.status === "pending_approval" && "border-warning/40 bg-warning/10 text-warning",
                  action.status === "failed" && "border-destructive/40 bg-destructive/10 text-destructive"
                )}
              >
                <Wrench className="size-3" />
                {action.summary} —{" "}
                {action.status === "executed"
                  ? "executed"
                  : action.status === "pending_approval"
                    ? "awaiting Board approval"
                    : "failed"}
              </span>
            ))}
          </div>
        )}
        {sources && sources.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {sources.map((source, i) => (
              <span
                key={`${source.documentId}-${source.chunkIndex}-${i}`}
                className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-xs text-muted-foreground"
                title={source.snippet}
              >
                <FileText className="size-3" />
                {source.filename}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
