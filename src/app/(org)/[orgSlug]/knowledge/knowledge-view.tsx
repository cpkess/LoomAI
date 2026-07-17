"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, FileUp, FolderPlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { formatBytes } from "@/lib/utils";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface DocumentItem {
  id: string;
  filename: string;
  status: string;
  error: string | null;
  chunkCount: number;
  sizeBytes: number;
}

export interface CollectionItem {
  id: string;
  name: string;
  description: string | null;
  workspaceIds: string[];
  documents: DocumentItem[];
}

const NONE = "__none__";

export function KnowledgeView({
  orgSlug,
  canManage,
  collections,
  departments,
  embeddingModels,
}: {
  orgSlug: string;
  canManage: boolean;
  collections: CollectionItem[];
  departments: { id: string; name: string }[];
  embeddingModels: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  // Poll while any document is still being ingested so statuses stay live.
  const hasPending = collections.some((c) => c.documents.some((d) => d.status === "pending" || d.status === "processing"));
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(timer);
  }, [hasPending, router]);

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Knowledge</h1>
          <p className="text-sm text-muted-foreground">
            Shared collections of documents that departments and AI employees can draw on.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <FolderPlus />
            New collection
          </Button>
        )}
      </div>

      {collections.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <BookOpen className="size-8" />
            No collections yet. Create one and upload PDFs, Office documents, Markdown, or notes.
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {collections.map((collection) => (
          <CollectionCard
            key={collection.id}
            orgSlug={orgSlug}
            canManage={canManage}
            collection={collection}
            departments={departments}
          />
        ))}
      </div>

      {creating && (
        <CreateCollectionDialog
          orgSlug={orgSlug}
          departments={departments}
          embeddingModels={embeddingModels}
          onClose={(saved) => {
            setCreating(false);
            if (saved) router.refresh();
          }}
        />
      )}
    </>
  );
}

function statusBadge(doc: DocumentItem) {
  switch (doc.status) {
    case "ready":
      return <Badge variant="success">ready</Badge>;
    case "error":
      return (
        <Badge variant="destructive" title={doc.error ?? undefined}>
          error
        </Badge>
      );
    case "processing":
      return (
        <Badge variant="warning">
          <Loader2 className="animate-spin" />
          processing
        </Badge>
      );
    default:
      return <Badge variant="outline">queued</Badge>;
  }
}

function CollectionCard({
  orgSlug,
  canManage,
  collection,
  departments,
}: {
  orgSlug: string;
  canManage: boolean;
  collection: CollectionItem;
  departments: { id: string; name: string }[];
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/orgs/${orgSlug}/collections/${collection.id}/documents`, {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`${file.name}: ${body.error ?? "upload failed"}`);
      }
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    router.refresh();
  }

  async function toggleDepartment(workspaceId: string) {
    const next = collection.workspaceIds.includes(workspaceId)
      ? collection.workspaceIds.filter((id) => id !== workspaceId)
      : [...collection.workspaceIds, workspaceId];
    const res = await fetch(`/api/orgs/${orgSlug}/collections/${collection.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceIds: next }),
    });
    if (!res.ok) toast.error("Could not update assignments");
    router.refresh();
  }

  async function removeCollection() {
    if (!confirm(`Delete collection "${collection.name}" and all its documents?`)) return;
    const res = await fetch(`/api/orgs/${orgSlug}/collections/${collection.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not delete collection");
      return;
    }
    router.refresh();
  }

  async function removeDocument(doc: DocumentItem) {
    const res = await fetch(`/api/orgs/${orgSlug}/collections/${collection.id}/documents/${doc.id}`, {
      method: "DELETE",
    });
    if (!res.ok) toast.error("Could not delete document");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{collection.name}</CardTitle>
            {collection.description && <CardDescription>{collection.description}</CardDescription>}
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept=".pdf,.docx,.md,.markdown,.txt,.csv,.json,.html"
              onChange={(e) => upload(e.target.files)}
            />
            <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
              {uploading ? <Loader2 className="animate-spin" /> : <FileUp />}
              {uploading ? "Uploading…" : "Upload"}
            </Button>
            {canManage && (
              <Button variant="ghost" size="icon" onClick={removeCollection}>
                <Trash2 />
              </Button>
            )}
          </div>
        </div>
        {canManage && departments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-muted-foreground">Available to:</span>
            {departments.map((d) => (
              <label
                key={d.id}
                className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs has-checked:border-primary has-checked:bg-accent"
              >
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={collection.workspaceIds.includes(d.id)}
                  onChange={() => toggleDepartment(d.id)}
                />
                {d.name}
              </label>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {collection.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents yet — upload PDFs, DOCX, Markdown, or text files.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Chunks</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {collection.documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="max-w-64 truncate font-medium" title={doc.filename}>
                    {doc.filename}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatBytes(doc.sizeBytes)}</TableCell>
                  <TableCell className="text-muted-foreground">{doc.chunkCount || "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      {statusBadge(doc)}
                      {doc.status === "error" && doc.error && (
                        <span className="max-w-72 truncate text-xs text-destructive" title={doc.error}>
                          {doc.error}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage && (
                      <Button variant="ghost" size="icon" onClick={() => removeDocument(doc)}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function CreateCollectionDialog({
  orgSlug,
  departments,
  embeddingModels,
  onClose,
}: {
  orgSlug: string;
  departments: { id: string; name: string }[];
  embeddingModels: { id: string; label: string }[];
  onClose: (saved: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [embeddingModelId, setEmbeddingModelId] = useState(NONE);
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await fetch(`/api/orgs/${orgSlug}/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description: description || undefined,
        embeddingModelId: embeddingModelId === NONE ? null : embeddingModelId,
        workspaceIds,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not create collection");
      return;
    }
    toast.success("Collection created");
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New knowledge collection</DialogTitle>
          <DialogDescription>
            A collection is one embedding space — its documents are searched together.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="collection-name">Name</Label>
            <Input
              id="collection-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Engineering handbook"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="collection-description">Description</Label>
            <Input
              id="collection-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Embedding model</Label>
            <Select value={embeddingModelId} onValueChange={setEmbeddingModelId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Auto — first available at ingest time</SelectItem>
                {embeddingModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {departments.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>Available to departments</Label>
              <div className="flex flex-wrap gap-2">
                {departments.map((d) => (
                  <label
                    key={d.id}
                    className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-sm has-checked:border-primary has-checked:bg-accent"
                  >
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={workspaceIds.includes(d.id)}
                      onChange={() =>
                        setWorkspaceIds((prev) =>
                          prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                        )
                      }
                    />
                    {d.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create collection"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
