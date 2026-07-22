"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  FileStack,
  FolderKanban,
  HelpCircle,
  Lightbulb,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Markdown } from "@/components/chat/markdown";
import { OutputActions } from "@/components/output/output-actions";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface ProjectListItem {
  id: string;
  title: string;
  description: string | null;
  nextSteps: string | null;
  itemCount: number;
  openQuestions: number;
  challenged: number;
  stale: number;
  sourceCount: number;
  deliverableCount: number;
  updatedAt: string;
}

export function ProjectsView({ orgSlug }: { orgSlug: string }) {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orgs/${orgSlug}/projects`);
    if (res.ok) setProjects((await res.json()).projects);
  }, [orgSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (openId) {
    return <ProjectDetail orgSlug={orgSlug} projectId={openId} onBack={() => { setOpenId(null); void load(); }} />;
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Living workstreams. Add sources and each project builds an evolving understanding — knowledge, contradictions,
            open questions, risks — and produces deliverables through a multi-stage AI workflow.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus />
          New project
        </Button>
      </div>

      {projects === null ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </CardContent>
        </Card>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <FolderKanban className="size-8" />
            No projects yet. Start one and add what you know — it becomes a living workstream.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {projects.map((p) => (
            <Card key={p.id} className="cursor-pointer transition-colors hover:border-primary/40" onClick={() => setOpenId(p.id)}>
              <CardHeader>
                <div className="flex items-start gap-3">
                  <FolderKanban className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <CardTitle className="truncate">{p.title}</CardTitle>
                    {p.description && <CardDescription className="truncate">{p.description}</CardDescription>}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                      <Badge variant="secondary">{p.itemCount} knowledge</Badge>
                      {p.openQuestions > 0 && <Badge variant="outline">{p.openQuestions} open questions</Badge>}
                      {p.challenged > 0 && <Badge variant="warning">{p.challenged} challenged</Badge>}
                      {p.stale > 0 && <Badge variant="warning">{p.stale} stale</Badge>}
                      <Badge variant="secondary">{p.sourceCount} sources</Badge>
                      <Badge variant="secondary">{p.deliverableCount} deliverables</Badge>
                    </div>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <CreateProjectDialog
          orgSlug={orgSlug}
          onClose={(saved) => {
            setCreating(false);
            if (saved) void load();
          }}
        />
      )}
    </>
  );
}

// --- Project detail --------------------------------------------------------

interface Project {
  id: string;
  title: string;
  description: string | null;
  status: string;
  nextSteps: string | null;
  lastAnalyzedAt: string | null;
}

function ProjectDetail({ orgSlug, projectId, onBack }: { orgSlug: string; projectId: string; onBack: () => void }) {
  const [project, setProject] = useState<Project | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orgs/${orgSlug}/projects/${projectId}`);
    if (res.ok) setProject((await res.json()).project);
  }, [orgSlug, projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft />
          Projects
        </Button>
      </div>
      <div>
        <h1 className="text-xl font-semibold">{project?.title ?? "…"}</h1>
        {project?.description && <p className="text-sm text-muted-foreground">{project.description}</p>}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="deliverables">Deliverables</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-3">
          <OverviewTab orgSlug={orgSlug} projectId={projectId} />
        </TabsContent>
        <TabsContent value="sources" className="pt-3">
          <SourcesTab orgSlug={orgSlug} projectId={projectId} />
        </TabsContent>
        <TabsContent value="knowledge" className="pt-3">
          <KnowledgeTab orgSlug={orgSlug} projectId={projectId} />
        </TabsContent>
        <TabsContent value="deliverables" className="pt-3">
          <DeliverablesTab orgSlug={orgSlug} projectId={projectId} />
        </TabsContent>
      </Tabs>
    </>
  );
}

// --- Overview / resume briefing --------------------------------------------

interface Briefing {
  nextSteps: string | null;
  lastAnalyzedAt: string | null;
  counts: { items: number; sources: number; deliverables: number };
  changedSince: { events: number; label: string };
  openQuestions: { id: string; content: string }[];
  challenged: { id: string; content: string }[];
  risks: { id: string; content: string }[];
  stale: { id: string; type: string; content: string }[];
  timeline: { id: string; kind: string; summary: string; createdAt: string }[];
}

function OverviewTab({ orgSlug, projectId }: { orgSlug: string; projectId: string }) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orgs/${orgSlug}/projects/${projectId}/briefing`);
    if (res.ok) setBriefing((await res.json()).briefing);
  }, [orgSlug, projectId]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function reevaluate() {
    setBusy(true);
    const res = await fetch(`/api/orgs/${orgSlug}/projects/${projectId}/reevaluate`, { method: "POST" });
    setBusy(false);
    if (res.ok) {
      toast.success("Re-evaluated");
      void load();
    } else toast.error("Could not re-evaluate");
  }

  if (!briefing) return <Loading />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">{briefing.counts.items} knowledge items</Badge>
        <Badge variant="secondary">{briefing.counts.sources} sources</Badge>
        <span>{briefing.changedSince.events} changes {briefing.changedSince.label}</span>
        <Button variant="outline" size="sm" className="ml-auto" disabled={busy} onClick={reevaluate}>
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Re-evaluate
        </Button>
      </div>

      {briefing.nextSteps && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-primary" />
              Recommended next steps
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Markdown>{briefing.nextSteps}</Markdown>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <ItemPanel title="Needs attention: stale" icon={Clock} tone="text-amber-500" items={briefing.stale.map((i) => i.content)} empty="Nothing stale." />
        <ItemPanel title="Contradictions / challenged" icon={AlertTriangle} tone="text-amber-500" items={briefing.challenged.map((i) => i.content)} empty="No unresolved contradictions." />
        <ItemPanel title="Open questions" icon={HelpCircle} tone="text-sky-500" items={briefing.openQuestions.map((i) => i.content)} empty="No open questions." />
        <ItemPanel title="Risks" icon={AlertTriangle} tone="text-red-500" items={briefing.risks.map((i) => i.content)} empty="No active risks." />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline</CardTitle>
          <CardDescription>How the project&apos;s understanding has evolved.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {briefing.timeline.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
          {briefing.timeline.map((e) => (
            <div key={e.id} className="flex items-start gap-2 text-sm">
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{e.kind}</span>
              <span className="min-w-0 flex-1">{e.summary}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ItemPanel({ title, icon: Icon, tone, items, empty }: { title: string; icon: typeof Clock; tone: string; items: string[]; empty: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className={`size-4 ${tone}`} />
          {title} {items.length > 0 && <Badge variant="warning">{items.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          items.map((c, i) => (
            <p key={i} className="text-sm">
              • {c}
            </p>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// --- Sources ---------------------------------------------------------------

interface SourceRow {
  id: string;
  kind: string;
  title: string;
  status: string;
  error: string | null;
  createdAt: string;
}

function SourcesTab({ orgSlug, projectId }: { orgSlug: string; projectId: string }) {
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orgs/${orgSlug}/projects/${projectId}/sources`);
    if (res.ok) setSources((await res.json()).sources);
  }, [orgSlug, projectId]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Add documents, notes, research or emails — each is analyzed into the project&apos;s knowledge.</p>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus />
          Add source
        </Button>
      </div>
      {sources === null ? (
        <Loading />
      ) : sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sources yet.</p>
      ) : (
        sources.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-md border p-3">
            <FileStack className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{s.title}</div>
              <div className="text-xs text-muted-foreground">{s.kind}</div>
            </div>
            {s.status === "pending" ? (
              <Badge variant="warning">
                <Loader2 className="size-3 animate-spin" />
                analyzing
              </Badge>
            ) : s.status === "analyzed" ? (
              <Badge variant="success">analyzed</Badge>
            ) : (
              <Badge variant="destructive">error</Badge>
            )}
          </div>
        ))
      )}
      {adding && <AddSourceDialog orgSlug={orgSlug} projectId={projectId} onClose={(saved) => { setAdding(false); if (saved) void load(); }} />}
    </div>
  );
}

// --- Knowledge graph -------------------------------------------------------

interface KItem {
  id: string;
  type: string;
  content: string;
  status: string;
  confidence: number;
}

function statusBadge(status: string) {
  switch (status) {
    case "challenged":
      return <Badge variant="warning">challenged</Badge>;
    case "stale":
      return <Badge variant="warning">stale</Badge>;
    case "resolved":
      return <Badge variant="success">resolved</Badge>;
    case "superseded":
      return <Badge variant="outline">superseded</Badge>;
    default:
      return <Badge variant="secondary">active</Badge>;
  }
}

function KnowledgeTab({ orgSlug, projectId }: { orgSlug: string; projectId: string }) {
  const [data, setData] = useState<{ items: KItem[]; edges: { relation: string }[] } | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orgs/${orgSlug}/projects/${projectId}/knowledge`);
    if (res.ok) {
      const b = await res.json();
      setData({ items: b.items, edges: b.edges });
    }
  }, [orgSlug, projectId]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return <Loading />;
  const byType = new Map<string, KItem[]>();
  for (const i of data.items) byType.set(i.type, [...(byType.get(i.type) ?? []), i]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {data.items.length} knowledge items, {data.edges.length} relationships. Click an item to see its evidence and how it evolved.
      </p>
      {data.items.length === 0 && <p className="text-sm text-muted-foreground">Add a source to start building knowledge.</p>}
      {[...byType.entries()].map(([type, items]) => (
        <div key={type} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium capitalize text-muted-foreground">{type}s</h3>
          {items.map((i) => (
            <button
              key={i.id}
              className="flex items-start gap-2 rounded-md border p-2.5 text-left text-sm hover:border-primary/40"
              onClick={() => setOpenItem(i.id)}
            >
              <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">{i.content}</span>
              {statusBadge(i.status)}
            </button>
          ))}
        </div>
      ))}
      {openItem && <ProvenanceDialog orgSlug={orgSlug} projectId={projectId} itemId={openItem} onClose={() => { setOpenItem(null); void load(); }} />}
    </div>
  );
}

function ProvenanceDialog({ orgSlug, projectId, itemId, onClose }: { orgSlug: string; projectId: string; itemId: string; onClose: () => void }) {
  const [data, setData] = useState<{
    item: KItem;
    evidence: { id: string; snippet: string }[];
    edges: { relation: string; rationale: string | null }[];
    history: { id: string; kind: string; summary: string; createdAt: string }[];
  } | null>(null);

  useEffect(() => {
    fetch(`/api/orgs/${orgSlug}/projects/${projectId}/knowledge/${itemId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
  }, [orgSlug, projectId, itemId]);

  async function act(patch: Record<string, unknown>) {
    const res = await fetch(`/api/orgs/${orgSlug}/projects/${projectId}/knowledge/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      toast.success("Updated");
      onClose();
    } else toast.error("Could not update");
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Knowledge item</DialogTitle>
          <DialogDescription>Its evidence, relationships, and how it evolved.</DialogDescription>
        </DialogHeader>
        {!data ? (
          <Loading />
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="mb-1 flex items-center gap-2">
                <Badge variant="secondary" className="capitalize">{data.item.type}</Badge>
                {statusBadge(data.item.status)}
                <span className="text-xs text-muted-foreground">confidence {Math.round(data.item.confidence * 100)}%</span>
              </div>
              {data.item.content}
            </div>
            <div>
              <div className="pb-1 text-xs font-medium text-muted-foreground">Evidence</div>
              {data.evidence.length === 0 ? (
                <p className="text-xs text-muted-foreground">No evidence recorded.</p>
              ) : (
                data.evidence.map((e) => (
                  <p key={e.id} className="border-l-2 pl-2 text-xs text-muted-foreground">{e.snippet}</p>
                ))
              )}
            </div>
            {data.edges.length > 0 && (
              <div>
                <div className="pb-1 text-xs font-medium text-muted-foreground">Relationships</div>
                {data.edges.map((e, i) => (
                  <p key={i} className="text-xs">
                    <Badge variant="outline" className="mr-1">{e.relation}</Badge>
                    {e.rationale}
                  </p>
                ))}
              </div>
            )}
            <div>
              <div className="pb-1 text-xs font-medium text-muted-foreground">History</div>
              {data.history.map((h) => (
                <div key={h.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded bg-muted px-1 py-0.5 text-[10px]">{h.kind}</span>
                  {h.summary}
                </div>
              ))}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => act({ markReviewed: true })}>
            Confirm still valid
          </Button>
          <Button variant="ghost" size="sm" onClick={() => act({ status: "resolved" })}>
            Mark resolved
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Deliverables ----------------------------------------------------------

interface DeliverableRow {
  id: string;
  title: string;
  kind: string;
  status: string;
  iteration: number;
}

function DeliverablesTab({ orgSlug, projectId }: { orgSlug: string; projectId: string }) {
  const [rows, setRows] = useState<DeliverableRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orgs/${orgSlug}/projects/${projectId}/deliverables`);
    if (res.ok) setRows((await res.json()).deliverables);
  }, [orgSlug, projectId]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  if (openId) return <DeliverableDetail orgSlug={orgSlug} projectId={projectId} deliverableId={openId} onBack={() => { setOpenId(null); void load(); }} />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Big outputs produced by an orchestrated multi-agent workflow — plan, write, critique, revise.</p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus />
          New deliverable
        </Button>
      </div>
      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No deliverables yet.</p>
      ) : (
        rows.map((d) => (
          <button key={d.id} className="flex items-center gap-3 rounded-md border p-3 text-left hover:border-primary/40" onClick={() => setOpenId(d.id)}>
            <FileStack className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{d.title}</div>
              <div className="text-xs text-muted-foreground">{d.kind}</div>
            </div>
            {deliverableBadge(d.status)}
          </button>
        ))
      )}
      {creating && <CreateDeliverableDialog orgSlug={orgSlug} projectId={projectId} onClose={(saved) => { setCreating(false); if (saved) void load(); }} />}
    </div>
  );
}

function deliverableBadge(status: string) {
  if (status === "completed") return <Badge variant="success">completed</Badge>;
  if (status === "failed") return <Badge variant="destructive">failed</Badge>;
  return (
    <Badge variant="warning">
      <Loader2 className="size-3 animate-spin" />
      {status}
    </Badge>
  );
}

interface Section {
  id: string;
  heading: string;
  brief: string | null;
  role: string;
  status: string;
  content: string | null;
  revision: number;
  issues: { kind: string; detail: string; severity: string }[];
}

function DeliverableDetail({ orgSlug, projectId, deliverableId, onBack }: { orgSlug: string; projectId: string; deliverableId: string; onBack: () => void }) {
  const [data, setData] = useState<{
    deliverable: { title: string; kind: string; status: string; iteration: number; content: string | null };
    sections: Section[];
    events: { id: string; kind: string; role: string | null; summary: string; createdAt: string }[];
  } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orgs/${orgSlug}/projects/${projectId}/deliverables/${deliverableId}`);
    if (res.ok) setData(await res.json());
  }, [orgSlug, projectId, deliverableId]);
  useEffect(() => {
    void load();
    const active = data?.deliverable.status !== "completed" && data?.deliverable.status !== "failed";
    const t = setInterval(load, active ? 2500 : 8000);
    return () => clearInterval(t);
  }, [load, data?.deliverable.status]);

  async function regenerate(sectionId: string) {
    const res = await fetch(`/api/orgs/${orgSlug}/projects/${projectId}/deliverables/${deliverableId}/sections/${sectionId}/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      toast.success("Regenerating section");
      void load();
    } else toast.error("Could not regenerate");
  }

  if (!data) return <Loading />;
  const d = data.deliverable;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft />
          Deliverables
        </Button>
        {deliverableBadge(d.status)}
        {d.iteration > 0 && <Badge variant="outline">revision round {d.iteration}</Badge>}
      </div>
      <div>
        <h2 className="text-lg font-semibold">{d.title}</h2>
        <p className="text-xs text-muted-foreground">{d.kind}</p>
      </div>

      {d.status === "completed" && d.content && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Final document</CardTitle>
          </CardHeader>
          <CardContent>
            <Markdown>{d.content}</Markdown>
            <OutputActions className="mt-2" text={d.content} defaultTitle={d.title} />
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">Outline</h3>
        {data.sections.map((s, i) => (
          <div key={s.id} className="rounded-lg border">
            <div className="flex items-center gap-2 p-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-background text-xs font-semibold text-muted-foreground ring-1 ring-border">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{s.heading}</div>
                {s.brief && <div className="truncate text-xs text-muted-foreground">{s.brief}</div>}
              </div>
              <Badge variant="outline" className="text-[10px]">{s.role}</Badge>
              {sectionBadge(s.status)}
            </div>
            {s.content && (
              <div className="border-t p-3 text-sm">
                <Markdown>{s.content}</Markdown>
                {s.issues.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                    {s.issues.map((iss, j) => (
                      <div key={j}>
                        <span className="font-medium">{iss.severity}</span> · {iss.kind}: {iss.detail}
                      </div>
                    ))}
                  </div>
                )}
                {d.status === "completed" && (
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => regenerate(s.id)}>
                    <RefreshCw />
                    Regenerate
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Production log</CardTitle>
          <CardDescription>Every step of the multi-stage workflow.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {data.events.map((e) => (
            <div key={e.id} className="flex items-start gap-2 text-sm">
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{e.kind}</span>
              <span className="min-w-0 flex-1">{e.summary}</span>
              {e.role && <span className="shrink-0 text-xs text-muted-foreground">{e.role}</span>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function sectionBadge(status: string) {
  switch (status) {
    case "approved":
      return <Badge variant="success">approved</Badge>;
    case "drafted":
      return <Badge variant="secondary">drafted</Badge>;
    case "reviewing":
      return <Badge variant="warning">reviewing</Badge>;
    case "revising":
      return (
        <Badge variant="warning">
          <Loader2 className="size-3 animate-spin" />
          revising
        </Badge>
      );
    case "drafting":
      return (
        <Badge variant="warning">
          <Loader2 className="size-3 animate-spin" />
          drafting
        </Badge>
      );
    default:
      return <Badge variant="outline">planned</Badge>;
  }
}

// --- Dialogs & helpers -----------------------------------------------------

function Loading() {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Loading…
    </div>
  );
}

function CreateProjectDialog({ orgSlug, onClose }: { orgSlug: string; onClose: (saved: boolean) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await fetch(`/api/orgs/${orgSlug}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: description || undefined }),
    });
    setPending(false);
    if (!res.ok) {
      toast.error("Could not create project");
      return;
    }
    toast.success("Project created — it's now a living workstream");
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>A living workstream. Describe the problem space; add sources as you go.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="p-title">Title</Label>
            <Input id="p-title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus placeholder="EU market expansion" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="p-desc">What is this about? (becomes the first source)</Label>
            <Textarea id="p-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Goals, context, what you already know…" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddSourceDialog({ orgSlug, projectId, onClose }: { orgSlug: string; projectId: string; onClose: (saved: boolean) => void }) {
  const [kind, setKind] = useState("note");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await fetch(`/api/orgs/${orgSlug}/projects/${projectId}/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, title, content }),
    });
    setPending(false);
    if (!res.ok) {
      toast.error("Could not add source");
      return;
    }
    toast.success("Source added — analyzing into the project's knowledge");
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a source</DialogTitle>
          <DialogDescription>Paste a note, research, meeting summary, competitor info, or email.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["note", "research", "document", "email", "manual"].map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="s-title">Title</Label>
              <Input id="s-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="s-content">Content</Label>
            <Textarea id="s-content" value={content} onChange={(e) => setContent(e.target.value)} rows={8} required placeholder="Paste the text to analyze…" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !title.trim() || !content.trim()}>
              {pending ? "Adding…" : "Add & analyze"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateDeliverableDialog({ orgSlug, projectId, onClose }: { orgSlug: string; projectId: string; onClose: (saved: boolean) => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("report");
  const [brief, setBrief] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await fetch(`/api/orgs/${orgSlug}/projects/${projectId}/deliverables`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, kind, brief: brief || undefined }),
    });
    setPending(false);
    if (!res.ok) {
      toast.error("Could not create deliverable");
      return;
    }
    toast.success("Producing — the team is planning the outline");
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New deliverable</DialogTitle>
          <DialogDescription>Produced by an orchestrated workflow: outline → specialist writers → critique → revision.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="d-title">Title</Label>
              <Input id="d-title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Type</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["report", "strategy", "prd", "research_summary", "proposal", "memo"].map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="d-brief">Brief</Label>
            <Textarea id="d-brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} placeholder="What should this deliverable achieve and cover?" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending ? "Starting…" : "Start production"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
