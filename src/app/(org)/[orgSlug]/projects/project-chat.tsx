"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUp, CircleAlert, FileText, Plus, Square } from "lucide-react";

import type { MessageSource } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/chat/markdown";
import { Textarea } from "@/components/ui/textarea";

type ChatMessage = UIMessage<{ sources?: MessageSource[] }>;

interface ConversationRow {
  id: string;
  title: string;
}

export function ProjectChat({ orgSlug, projectId }: { orgSlug: string; projectId: string }) {
  const base = `/api/orgs/${orgSlug}/projects/${projectId}/chat`;
  const [conversations, setConversations] = useState<ConversationRow[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [initial, setInitial] = useState<ChatMessage[]>([]);

  const loadConversations = useCallback(async () => {
    const res = await fetch(`${base}/conversations`);
    if (!res.ok) return;
    const data = await res.json();
    setConversations(data.conversations);
    if (!activeId && data.conversations.length > 0) setActiveId(data.conversations[0].id);
  }, [base, activeId]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  // Load history when the active conversation changes.
  useEffect(() => {
    if (!activeId) {
      setInitial([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch(`${base}/conversations/${activeId}`);
      if (!res.ok || cancelled) return;
      const data = await res.json();
      setInitial(
        (data.messages as { id: string; role: string; content: string; sources?: MessageSource[] }[])
          .filter((m) => m.role !== "system")
          .map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            parts: [{ type: "text" as const, text: m.content }],
            metadata: m.sources?.length ? { sources: m.sources } : undefined,
          }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, base]);

  async function newConversation() {
    const res = await fetch(`${base}/conversations`, { method: "POST" });
    if (!res.ok) return;
    const data = await res.json();
    await loadConversations();
    setActiveId(data.conversation.id);
    setInitial([]);
  }

  return (
    <div className="flex min-h-[28rem] gap-4">
      <aside className="flex w-56 shrink-0 flex-col gap-2">
        <Button size="sm" variant="outline" onClick={newConversation}>
          <Plus />
          New chat
        </Button>
        <div className="flex flex-col gap-1">
          {conversations?.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={`truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                c.id === activeId ? "bg-accent font-medium" : "text-muted-foreground"
              }`}
            >
              {c.title}
            </button>
          ))}
          {conversations?.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">No chats yet. Start one to ask about this project.</p>
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1 rounded-lg border">
        {activeId ? (
          <Thread key={activeId} base={base} conversationId={activeId} initialMessages={initial} onTitle={loadConversations} />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
            Start a new chat to ask the project assistant — it answers from this project&apos;s knowledge.
          </div>
        )}
      </div>
    </div>
  );
}

function Thread({
  base,
  conversationId,
  initialMessages,
  onTitle,
}: {
  base: string;
  conversationId: string;
  initialMessages: ChatMessage[];
  onTitle: () => void;
}) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, stop } = useChat<ChatMessage>({
    id: conversationId,
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: base, body: { conversationId } }),
    onFinish: () => onTitle(),
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-5 p-4">
          {messages.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Ask anything about this project — grounded in its sources and knowledge.
            </p>
          )}
          {messages.map((m) => {
            const text = m.parts
              .filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join("");
            const sources = m.metadata?.sources ?? [];
            return (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  {m.role === "assistant" ? <Markdown>{text}</Markdown> : <div className="whitespace-pre-wrap">{text}</div>}
                  {sources.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1 border-t pt-2 text-xs text-muted-foreground">
                      {sources.map((s, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <FileText className="size-3" />
                          <span className="truncate">{s.filename}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <CircleAlert className="size-4" />
              {error.message}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t p-3">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask the project assistant…"
            className="min-h-10 max-h-40 resize-none"
            rows={1}
          />
          {busy ? (
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
    </div>
  );
}
