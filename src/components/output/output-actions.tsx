"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { Check, Copy, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
    </div>
  );
}
