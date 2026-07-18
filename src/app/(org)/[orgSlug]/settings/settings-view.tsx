"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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

interface DepartmentItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  defaultModelId: string | null;
}

const NONE = "__none__";

const GOVERNANCE_LABELS: Record<string, string> = {
  hire_employee: "Hire AI employees",
  update_employee: "Edit AI employees (title, persona, manager, pause)",
  offboard_employee: "Offboard AI employees",
  create_department: "Create departments",
  assign_to_department: "Change department staffing",
};

export function SettingsView({
  orgSlug,
  orgName,
  departments,
  models,
  governance,
}: {
  orgSlug: string;
  orgName: string;
  departments: DepartmentItem[];
  models: { id: string; label: string }[];
  governance: Record<string, "auto" | "board">;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function setDefaultModel(department: DepartmentItem, modelId: string) {
    const res = await fetch(`/api/orgs/${orgSlug}/workspaces/${department.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultModelId: modelId === NONE ? null : modelId }),
    });
    if (!res.ok) {
      toast.error("Could not update default model");
      return;
    }
    toast.success(`${department.name} default model updated`);
    router.refresh();
  }

  async function remove(department: DepartmentItem) {
    if (!confirm(`Delete department "${department.name}"? Its conversations and staffing assignments are removed.`))
      return;
    const res = await fetch(`/api/orgs/${orgSlug}/workspaces/${department.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not delete department");
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage {orgName}&apos;s departments and defaults.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Departments</CardTitle>
              <CardDescription>
                Each department is a workspace with its own chats, staff, knowledge, and default model.
              </CardDescription>
            </div>
            <Button onClick={() => setCreating(true)}>
              <Plus />
              New department
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {departments.length === 0 && <p className="text-sm text-muted-foreground">No departments yet.</p>}
          {departments.map((department) => (
            <div key={department.id} className="flex items-center gap-3 rounded-md border p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{department.name}</div>
                <div className="text-xs text-muted-foreground">/{department.slug}</div>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Default model</Label>
                <Select
                  value={department.defaultModelId ?? NONE}
                  onValueChange={(v) => setDefaultModel(department, v)}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>First available model</SelectItem>
                    {models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" onClick={() => remove(department)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Governance</CardTitle>
          <CardDescription>
            Decide which company actions AI employees can take autonomously and which need Board approval
            (organization admins are the Board). Approved proposals execute automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {Object.entries(GOVERNANCE_LABELS).map(([type, label]) => (
            <div key={type} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="text-sm font-medium">{label}</div>
              <Select
                value={governance[type] ?? "board"}
                onValueChange={async (mode) => {
                  const res = await fetch(`/api/orgs/${orgSlug}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ governance: { [type]: mode } }),
                  });
                  if (!res.ok) {
                    toast.error("Could not update governance policy");
                    return;
                  }
                  toast.success("Governance policy updated");
                  router.refresh();
                }}
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Autonomous</SelectItem>
                  <SelectItem value="board">Requires Board approval</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </CardContent>
      </Card>

      {creating && (
        <CreateDepartmentDialog
          orgSlug={orgSlug}
          onClose={(saved) => {
            setCreating(false);
            if (saved) router.refresh();
          }}
        />
      )}
    </>
  );
}

function CreateDepartmentDialog({ orgSlug, onClose }: { orgSlug: string; onClose: (saved: boolean) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await fetch(`/api/orgs/${orgSlug}/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: description || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not create department");
      return;
    }
    toast.success("Department created");
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New department</DialogTitle>
          <DialogDescription>e.g. Marketing, Engineering, Legal, HR, Customer Support.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="dept-name">Name</Label>
            <Input id="dept-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="dept-description">Description</Label>
            <Input id="dept-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create department"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
