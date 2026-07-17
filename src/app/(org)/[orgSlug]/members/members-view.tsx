"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { initials } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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

interface MemberItem {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  title: string | null;
}

const ROLES = [
  { value: "member", label: "Member" },
  { value: "workspace_manager", label: "Workspace manager" },
  { value: "org_admin", label: "Organization admin" },
];

export function MembersView({
  orgSlug,
  currentUserId,
  members,
}: {
  orgSlug: string;
  currentUserId: string;
  members: MemberItem[];
}) {
  const router = useRouter();
  const [inviting, setInviting] = useState(false);

  async function changeRole(member: MemberItem, role: string) {
    const res = await fetch(`/api/orgs/${orgSlug}/members/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not change role");
      return;
    }
    router.refresh();
  }

  async function remove(member: MemberItem) {
    if (!confirm(`Remove ${member.name} from the organization?`)) return;
    const res = await fetch(`/api/orgs/${orgSlug}/members/${member.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not remove member");
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Members</h1>
          <p className="text-sm text-muted-foreground">Invite people and assign their roles.</p>
        </div>
        <Button onClick={() => setInviting(true)}>
          <UserPlus />
          Invite member
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Role</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.id}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback>{initials(member.name)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-medium">{member.name}</div>
                    <div className="text-xs text-muted-foreground">{member.email}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">{member.title ?? "—"}</TableCell>
              <TableCell>
                <Select value={member.role} onValueChange={(role) => changeRole(member, role)}>
                  <SelectTrigger className="w-48" disabled={member.userId === currentUserId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell className="text-right">
                {member.userId !== currentUserId && (
                  <Button variant="ghost" size="icon" onClick={() => remove(member)}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {inviting && (
        <InviteDialog
          orgSlug={orgSlug}
          onClose={(saved) => {
            setInviting(false);
            if (saved) router.refresh();
          }}
        />
      )}
    </>
  );
}

function InviteDialog({ orgSlug, onClose }: { orgSlug: string; onClose: (saved: boolean) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await fetch(`/api/orgs/${orgSlug}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, role, title: title || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not invite member");
      return;
    }
    if (body.tempPassword) {
      setTempPassword(body.tempPassword);
    } else {
      toast.success("Member added");
      onClose(true);
    }
  }

  if (tempPassword) {
    return (
      <Dialog open onOpenChange={() => onClose(true)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Account created</DialogTitle>
            <DialogDescription>
              Share this temporary password with {name} — it is shown only once. They can sign in with it and should
              change it afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 font-mono text-sm">
            <span className="flex-1">{tempPassword}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(tempPassword);
                toast.success("Copied");
              }}
            >
              <Copy />
              Copy
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => onClose(true)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
          <DialogDescription>
            If the email has no account yet, one is created and you get a temporary password to share.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-name">Name</Label>
              <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-title">Job title (optional)</Label>
              <Input id="invite-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Inviting…" : "Invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
