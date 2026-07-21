"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BookPlus, Check, Copy, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Copy-to-clipboard button for a piece of text. */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("h-7 gap-1 px-2 text-xs text-muted-foreground", className)}
      onClick={copy}
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

const NEW = "__new__";

/** Save a piece of output into the knowledge base (existing or new collection). */
export function AddToKnowledgeButton({
  text,
  defaultTitle,
  className,
}: {
  text: string;
  defaultTitle: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn("h-7 gap-1 px-2 text-xs text-muted-foreground", className)}
        onClick={() => setOpen(true)}
      >
        <BookPlus className="size-3.5" />
        Add to knowledge
      </Button>
      {open && (
        <AddToKnowledgeDialog text={text} defaultTitle={defaultTitle} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function AddToKnowledgeDialog({
  text,
  defaultTitle,
  onClose,
}: {
  text: string;
  defaultTitle: string;
  onClose: () => void;
}) {
  const params = useParams<{ orgSlug: string }>();
  const [collections, setCollections] = useState<{ id: string; name: string }[] | null>(null);
  const [title, setTitle] = useState(defaultTitle.slice(0, 200));
  const [target, setTarget] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/orgs/${params.orgSlug}/collections`)
      .then((r) => (r.ok ? r.json() : { collections: [] }))
      .then((body) => {
        const list = (body.collections ?? []) as { id: string; name: string }[];
        setCollections(list);
        setTarget(list.length > 0 ? list[0].id : NEW);
      })
      .catch(() => setCollections([]));
  }, [params.orgSlug]);

  async function save() {
    setSaving(true);
    const payload =
      target === NEW
        ? { title, content: text, newCollectionName: newName }
        : { title, content: text, collectionId: target };
    const res = await fetch(`/api/orgs/${params.orgSlug}/knowledge/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not add to knowledge base");
      return;
    }
    toast.success("Added to the knowledge base — indexing now");
    onClose();
  }

  const valid = title.trim() && (target !== NEW ? target : newName.trim());

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to knowledge base</DialogTitle>
          <DialogDescription>
            Save this output as a document. It is chunked and embedded so agents can retrieve it later.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="kb-title">Title</Label>
            <Input id="kb-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Collection</Label>
            {collections === null ? (
              <p className="text-sm text-muted-foreground">Loading collections…</p>
            ) : (
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {collections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW}>+ New collection…</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          {target === NEW && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="kb-new">New collection name</Label>
              <Input
                id="kb-new"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Agent outputs"
              />
            </div>
          )}
          <div className="max-h-32 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            {text.length > 600 ? `${text.slice(0, 600)}…` : text}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" disabled={saving || !valid} onClick={save}>
            {saving ? "Adding…" : "Add to knowledge base"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const DOWNLOAD_FORMATS = [
  { format: "pdf", label: "PDF" },
  { format: "docx", label: "Word (.docx)" },
  { format: "md", label: "Markdown" },
  { format: "html", label: "HTML" },
] as const;

/** Download a deliverable as a real file (PDF / Word / Markdown / HTML). */
export function DownloadButton({
  text,
  defaultTitle,
  className,
}: {
  text: string;
  defaultTitle: string;
  className?: string;
}) {
  const params = useParams<{ orgSlug: string }>();
  const [busy, setBusy] = useState<string | null>(null);

  async function download(format: string) {
    setBusy(format);
    try {
      const res = await fetch(`/api/orgs/${params.orgSlug}/deliverables/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: defaultTitle.slice(0, 200), content: text, format }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Could not generate the file");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const name = match?.[1] ?? "deliverable";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not download the file");
    } finally {
      setBusy(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-7 gap-1 px-2 text-xs text-muted-foreground", className)}
          disabled={busy !== null}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          Download
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {DOWNLOAD_FORMATS.map((f) => (
          <DropdownMenuItem key={f.format} disabled={busy !== null} onSelect={() => void download(f.format)}>
            {f.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Convenience row combining the output actions for an assistant/agent output. */
export function OutputActions({
  text,
  defaultTitle,
  className,
}: {
  text: string;
  defaultTitle: string;
  className?: string;
}) {
  if (!text.trim()) return null;
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <CopyButton text={text} />
      <DownloadButton text={text} defaultTitle={defaultTitle} />
      <AddToKnowledgeButton text={text} defaultTitle={defaultTitle} />
    </div>
  );
}
