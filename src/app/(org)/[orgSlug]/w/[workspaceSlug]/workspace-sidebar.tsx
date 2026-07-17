"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { Bot, MessageSquare, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export interface StaffItem {
  id: string;
  name: string;
  title: string;
  status: string;
  avatarColor: string | null;
}

export function WorkspaceSidebar({
  base,
  workspaceName,
  staff,
  conversations,
}: {
  base: string;
  workspaceName: string;
  staff: StaffItem[];
  conversations: { id: string; title: string; agentId: string | null }[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams<{ orgSlug: string }>();

  async function deleteConversation(id: string) {
    const res = await fetch(`/api/orgs/${params.orgSlug}/w/${base.split("/w/")[1]}/conversations/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Could not delete conversation");
      return;
    }
    if (pathname === `${base}/c/${id}`) router.push(base);
    router.refresh();
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar/50">
      <div className="flex items-center justify-between p-3">
        <span className="truncate text-sm font-semibold">{workspaceName}</span>
        <Button asChild size="sm" variant="outline">
          <Link href={base}>
            <Plus />
            New chat
          </Link>
        </Button>
      </div>
      <Separator />

      <div className="flex flex-col gap-1 p-3">
        <div className="px-1 pb-1 text-xs font-medium text-muted-foreground">Department staff</div>
        {staff.length === 0 && (
          <p className="px-1 text-xs text-muted-foreground">
            No AI employees staffed here yet.
          </p>
        )}
        {staff.map((agent) => (
          <div key={agent.id} className="flex items-center gap-2 rounded-md px-1 py-1">
            <AgentAvatar name={agent.name} color={agent.avatarColor} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 truncate text-sm font-medium">
                {agent.name}
                {agent.status === "paused" && <span className="text-xs text-muted-foreground">(paused)</span>}
              </div>
              <div className="truncate text-xs text-muted-foreground">{agent.title}</div>
            </div>
          </div>
        ))}
      </div>
      <Separator />

      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
        <div className="px-1 pb-1 text-xs font-medium text-muted-foreground">Conversations</div>
        {conversations.length === 0 && <p className="px-1 text-xs text-muted-foreground">No conversations yet.</p>}
        {conversations.map((c) => {
          const href = `${base}/c/${c.id}`;
          const active = pathname === href;
          return (
            <div
              key={c.id}
              className={cn(
                "group flex items-center gap-1 rounded-md text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                active && "bg-accent font-medium text-accent-foreground"
              )}
            >
              <Link href={href} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5">
                {c.agentId ? <Bot className="size-3.5 shrink-0" /> : <MessageSquare className="size-3.5 shrink-0" />}
                <span className="truncate">{c.title}</span>
              </Link>
              <button
                className="mr-1 hidden rounded p-1 text-muted-foreground hover:text-destructive group-hover:block"
                onClick={() => deleteConversation(c.id)}
                aria-label="Delete conversation"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
