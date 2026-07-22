"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Copy, Plus } from "lucide-react";
import { toast } from "sonner";

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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  members: number;
  projects: number;
}

export function OrganizationsView({ organizations }: { organizations: OrgRow[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Organizations</h1>
          <p className="text-sm text-muted-foreground">
            Tenants on this deployment. Each is fully isolated: its own members, projects, knowledge, and prompts.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus />
          Create organization
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Projects</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {organizations.map((org) => (
            <TableRow key={org.id}>
              <TableCell>
                <div className="font-medium">{org.name}</div>
                <div className="text-xs text-muted-foreground">/{org.slug}</div>
              </TableCell>
              <TableCell>{org.members}</TableCell>
              <TableCell>{org.projects}</TableCell>
              <TableCell className="text-right">
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/${org.slug}/dashboard`}>
                    Open
                    <ArrowUpRight />
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {creating && (
        <CreateOrgDialog
          onClose={(saved) => {
            setCreating(false);
            if (saved) router.refresh();
          }}
        />
      )}
    </>
  );
}

function CreateOrgDialog({ onClose }: { onClose: (saved: boolean) => void }) {
  const [name, setName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await fetch("/api/admin/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, adminName, adminEmail }),
    });
    const body = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not create organization");
      return;
    }
    if (body.tempPassword) {
      setTempPassword(body.tempPassword);
    } else {
      toast.success("Organization created");
      onClose(true);
    }
  }

  if (tempPassword) {
    return (
      <Dialog open onOpenChange={() => onClose(true)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Organization created</DialogTitle>
            <DialogDescription>
              Share this temporary password with {adminName} ({adminEmail}) — it is shown only once.
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
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>Set up a new tenant and its first organization admin.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="org-name">Organization name</Label>
            <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="org-admin-name">Admin name</Label>
              <Input id="org-admin-name" value={adminName} onChange={(e) => setAdminName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="org-admin-email">Admin email</Label>
              <Input
                id="org-admin-email"
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create organization"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
