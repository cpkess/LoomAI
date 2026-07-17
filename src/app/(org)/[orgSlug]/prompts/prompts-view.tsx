"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, ScrollText, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { extractVariables } from "@/lib/prompts/interpolate";
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
import { Textarea } from "@/components/ui/textarea";

export interface PromptItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  content: string;
  variables: string[];
  version: number;
  history: { version: number; content: string }[];
}

export function PromptsView({
  orgSlug,
  canManage,
  prompts,
}: {
  orgSlug: string;
  canManage: boolean;
  prompts: PromptItem[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<PromptItem | null>(null);
  const [creating, setCreating] = useState(false);

  const categories = useMemo(() => {
    const map = new Map<string, PromptItem[]>();
    for (const prompt of prompts) {
      const list = map.get(prompt.category) ?? [];
      list.push(prompt);
      map.set(prompt.category, list);
    }
    return [...map.entries()];
  }, [prompts]);

  async function remove(prompt: PromptItem) {
    if (!confirm(`Delete prompt "${prompt.name}"?`)) return;
    const res = await fetch(`/api/orgs/${orgSlug}/prompts/${prompt.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not delete prompt");
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Prompt library</h1>
          <p className="text-sm text-muted-foreground">
            Reusable prompts with {"{{variables}}"}, categories, and version history. Personas for AI employees live
            here too.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus />
            New prompt
          </Button>
        )}
      </div>

      {prompts.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <ScrollText className="size-8" />
            No prompts yet.
          </CardContent>
        </Card>
      )}

      {categories.map(([category, items]) => (
        <div key={category} className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{category}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((prompt) => (
              <Card key={prompt.id} className="gap-3 py-4">
                <CardHeader className="px-4">
                  <CardTitle className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{prompt.name}</span>
                    <Badge variant="outline">v{prompt.version}</Badge>
                  </CardTitle>
                  {prompt.description && <CardDescription>{prompt.description}</CardDescription>}
                </CardHeader>
                <CardContent className="flex flex-col gap-3 px-4">
                  <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{prompt.content}</p>
                  {prompt.variables.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {prompt.variables.map((variable) => (
                        <Badge key={variable} variant="secondary" className="font-mono text-[10px]">
                          {`{{${variable}}}`}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {canManage && (
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" onClick={() => setEditing(prompt)}>
                        <Pencil />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto text-destructive"
                        onClick={() => remove(prompt)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

      {(creating || editing) && (
        <PromptDialog
          orgSlug={orgSlug}
          prompt={editing}
          onClose={(saved) => {
            setCreating(false);
            setEditing(null);
            if (saved) router.refresh();
          }}
        />
      )}
    </>
  );
}

function PromptDialog({
  orgSlug,
  prompt,
  onClose,
}: {
  orgSlug: string;
  prompt: PromptItem | null;
  onClose: (saved: boolean) => void;
}) {
  const [name, setName] = useState(prompt?.name ?? "");
  const [description, setDescription] = useState(prompt?.description ?? "");
  const [category, setCategory] = useState(prompt?.category ?? "General");
  const [content, setContent] = useState(prompt?.content ?? "");
  const [pending, setPending] = useState(false);

  const variables = useMemo(() => extractVariables(content), [content]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await fetch(
      prompt ? `/api/orgs/${orgSlug}/prompts/${prompt.id}` : `/api/orgs/${orgSlug}/prompts`,
      {
        method: prompt ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || undefined, category, content }),
      }
    );
    const body = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not save prompt");
      return;
    }
    toast.success(prompt ? "Prompt updated" : "Prompt created");
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{prompt ? `Edit ${prompt.name}` : "New prompt"}</DialogTitle>
          <DialogDescription>
            Use {"{{variable}}"} placeholders — they are detected automatically. Editing content creates a new
            version.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="prompt-name">Name</Label>
              <Input id="prompt-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="prompt-category">Category</Label>
              <Input
                id="prompt-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="General, Personas, Writing…"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="prompt-description">Description</Label>
            <Input id="prompt-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="prompt-content">Content</Label>
            <Textarea
              id="prompt-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              required
            />
            {variables.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                Variables:
                {variables.map((v) => (
                  <Badge key={v} variant="secondary" className="font-mono text-[10px]">
                    {`{{${v}}}`}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {prompt && prompt.history.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>Version history</Label>
              <div className="flex max-h-40 flex-col gap-2 overflow-y-auto rounded-md border p-2">
                {prompt.history.map((entry) => (
                  <details key={entry.version} className="text-xs">
                    <summary className="cursor-pointer font-medium">Version {entry.version}</summary>
                    <p className="whitespace-pre-wrap py-1 text-muted-foreground">{entry.content}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setContent(entry.content)}
                    >
                      Restore this version
                    </Button>
                  </details>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : prompt ? "Save (new version)" : "Create prompt"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
