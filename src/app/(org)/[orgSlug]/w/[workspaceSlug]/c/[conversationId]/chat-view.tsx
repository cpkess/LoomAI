"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUp, CircleAlert, FileText, Square, User } from "lucide-react";

import type { MessageSource } from "@/lib/db/schema";
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
}

type ChatMessage = UIMessage<{ sources?: MessageSource[] }>;

function toUIMessages(initial: InitialMessage[]): ChatMessage[] {
  return initial
    .filter((m) => m.role !== "system")
    .map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      parts: [{ type: "text" as const, text: m.content }],
      metadata: m.sources ? { sources: m.sources } : undefined,
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
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            isUser ? "bg-primary text-primary-foreground" : "bg-muted/60"
          )}
        >
          {isUser ? <p className="whitespace-pre-wrap">{text}</p> : <Markdown>{text}</Markdown>}
        </div>
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
