"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileText, GitBranch, GitMerge, Loader2, MessageSquare, Presentation, Search, ShieldAlert, Sparkles, Target } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

import { layoutRounds } from "./round-lanes";

interface Problem {
  coreProblem: string;
  whyItMatters: string;
  decision: string;
  solutionCriteria: string[];
}
interface SolutionModel {
  title: string;
  executiveSummary: string;
  recommendation: string;
  findings: { title: string; detail: string }[];
  analysis: { point: string; evidence: string }[];
  risks: { risk: string; mitigation: string }[];
  plan: { step: string; detail: string; owner: string }[];
  metrics: { name: string; value: string; note: string }[];
}
interface Verification {
  solvesProblem: boolean;
  score: number;
  gaps: string[];
  fixes: string[];
}
interface Evidence {
  id: string;
  snippet: string;
  source: string;
  kind: string;
  url?: string | null;
  score?: number;
  question?: string;
}
interface ResearchRecord {
  questions: { question: string; why: string; found: number }[];
  rounds: number;
  counts: { document: number; knowledge: number; web: number };
  blocked: { url: string; reason: string; detail: string }[];
  citation: { claims: number; cited: number; coverage: number; unknownRefs: string[] } | null;
}

const BLOCK_LABEL: Record<string, string> = {
  captcha: "CAPTCHA — skipped, not solved",
  bot_wall: "blocked by bot protection",
  rate_limited: "rate-limited — backed off",
  login_required: "needs a login",
  paywall: "paywalled",
};
interface SolutionState {
  id: string;
  status: string;
  iteration: number;
  round: number;
  direction: string | null;
  mergedFrom: string[];
  researchMode: boolean;
  problem: Problem | null;
  model: SolutionModel | null;
  evidence: Evidence[];
  research: ResearchRecord | null;
  verification: Verification | null;
}
interface RoundSummary {
  id: string;
  round: number;
  direction: string | null;
  status: string;
  score: number | null;
  parentId: string | null;
  mergedFrom: string[];
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  diagnosing: "Diagnosing the real problem…",
  researching: "Researching — decomposing the problem and chasing sources…",
  solving: "Producing the solution…",
  verifying: "Checking it solves the problem…",
  revising: "Closing gaps…",
};

export function ProjectSolution({ orgSlug, projectId }: { orgSlug: string; projectId: string }) {
  const base = `/api/orgs/${orgSlug}/projects/${projectId}/solution`;
  const [sol, setSol] = useState<SolutionState | null | undefined>(undefined);
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [viewing, setViewing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [research, setResearch] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch(viewing ? `${base}?solutionId=${viewing}` : base);
    if (res.ok) {
      const body = await res.json();
      setSol(body.solution);
      setRounds(body.rounds ?? []);
    }
  }, [base, viewing]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [load]);

  async function post(body: Record<string, unknown>, success: string) {
    setStarting(true);
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ research, ...body }),
    });
    setStarting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Could not start");
      return;
    }
    // Whatever we just started becomes the round on screen.
    setViewing(null);
    setSelected([]);
    toast.success(success);
    void load();
  }

  async function solve(direction?: string) {
    // A steer forks from the round you are looking at, so exploring an earlier
    // answer's alternative doesn't have to go through the latest one.
    await post(
      direction ? { direction, ...(viewing ? { from: viewing } : {}) } : {},
      direction ? "New round — researching the avenue you asked for" : research ? "Solving — gathering evidence first" : "Solving — diagnosing the core problem first"
    );
  }

  async function compare(ids: string[], direction: string) {
    await post({ compare: ids, ...(direction ? { direction } : {}) }, "Weighing those rounds against each other");
  }

  if (sol === undefined) return <Loading />;

  const running = sol && !["completed", "failed"].includes(sol.status);

  // Empty state — the hero pitch + one button.
  if (!sol) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
          <Target className="size-10 text-primary" />
          <div className="max-w-md">
            <h3 className="text-lg font-semibold">Solve this in one move</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Turn the brief and everything the project knows into one coherent answer — the real problem diagnosed, a clear
              recommendation, findings, risks, a plan and the numbers — then download it as a report, a deck, a model, or a
              one-pager. All from one source, so they always agree.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={research} onCheckedChange={setResearch} />
            <span>Deep research — break the problem into questions and source each one first</span>
          </label>
          <Button onClick={() => void solve()} disabled={starting}>
            {starting ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Generate solution
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="size-3 animate-spin" />
            {STATUS_LABEL[sol.status] ?? sol.status}
          </Badge>
        ) : sol.status === "failed" ? (
          <Badge variant="destructive">failed</Badge>
        ) : sol.verification ? (
          <Badge variant={sol.verification.solvesProblem ? "success" : "warning"} className="gap-1">
            {sol.verification.solvesProblem ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
            {sol.verification.solvesProblem ? "Solves the problem" : "Best effort"} · {sol.verification.score}/100
          </Badge>
        ) : null}
        {sol.round > 1 && <Badge variant="secondary">round {sol.round}</Badge>}
        {sol.iteration > 0 && <Badge variant="outline">revision {sol.iteration}</Badge>}
        <div className="ml-auto flex items-center gap-2">
          {sol.model && <DownloadBar base={base} solutionId={sol.id} />}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch checked={research} onCheckedChange={setResearch} />
            Research
          </label>
          <Button size="sm" variant="outline" onClick={() => void solve()} disabled={starting || Boolean(running)}>
            {starting ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Re-solve
          </Button>
        </div>
      </div>

      {rounds.length > 1 && (
        <RoundLanes
          rounds={rounds}
          currentId={sol.id}
          latestId={rounds[0]?.id ?? null}
          selected={selected}
          busy={starting}
          onPick={(id) => setViewing(id)}
          onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-4)))}
          onCompare={() => void compare(selected, "")}
        />
      )}

      {sol.mergedFrom.length > 0 ? (
        <div className="flex items-start gap-2 rounded-md border-l-2 border-violet-500 bg-muted/40 p-3 text-sm">
          <GitMerge className="mt-0.5 size-4 shrink-0 text-violet-500" />
          <div>
            <span className="text-xs font-medium text-muted-foreground">
              Weighing {sol.mergedFrom.length} avenues against each other
            </span>
            <p>
              Evidence is pooled from rounds{" "}
              {rounds
                .filter((r) => sol.mergedFrom.includes(r.id))
                .map((r) => r.round)
                .sort((a, b) => a - b)
                .join(" and ")}
              , with each avenue given equal room.
            </p>
            {sol.direction && <p className="mt-1 text-muted-foreground">You also asked: {sol.direction}</p>}
          </div>
        </div>
      ) : (
        sol.direction && (
          <div className="flex items-start gap-2 rounded-md border-l-2 border-primary bg-muted/40 p-3 text-sm">
            <MessageSquare className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <span className="text-xs font-medium text-muted-foreground">You asked this round to:</span>
              <p>{sol.direction}</p>
            </div>
          </div>
        )
      )}

      {sol.problem && <ProblemCard problem={sol.problem} />}

      {sol.model ? (
        <SolutionCard model={sol.model} verification={sol.verification} />
      ) : running ? (
        <Loading label={STATUS_LABEL[sol.status]} />
      ) : null}

      {sol.research && <ResearchCard research={sol.research} />}

      {sol.evidence.length > 0 && <EvidenceCard evidence={sol.evidence} />}

      {!running && <FollowUpCard busy={starting} round={sol.round} onAsk={(d) => void solve(d)} />}
    </div>
  );
}

/**
 * Ask for another round. This is the main way to steer the work: the feedback
 * becomes the brief for a fresh research pass that keeps what's already been
 * found and goes after the avenue you name.
 */
function FollowUpCard({ busy, round, onAsk }: { busy: boolean; round: number; onAsk: (direction: string) => void }) {
  const [text, setText] = useState("");
  const direction = text.trim();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="size-4 text-primary" />
          Not what you needed?
        </CardTitle>
        <CardDescription>
          Point it somewhere else and it runs another round — new research questions aimed at what you asked for, with the
          evidence already gathered carried forward. The current answer is kept, so you can compare.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Ignore the partner route — look at what acquiring a local competitor would cost, and what the regulatory timeline would be."
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && direction) onAsk(direction);
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Branches from round {round} · ⌘/Ctrl + Enter to run
          </span>
          <Button size="sm" disabled={busy || !direction} onClick={() => onAsk(direction)}>
            {busy ? <Loader2 className="animate-spin" /> : <Search />}
            Research this
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Earlier rounds stay reachable, so a steer that went nowhere isn't a loss. */
function RoundLanes({
  rounds,
  currentId,
  latestId,
  selected,
  busy,
  onPick,
  onToggle,
  onCompare,
}: {
  rounds: RoundSummary[];
  currentId: string;
  latestId: string | null;
  selected: string[];
  busy: boolean;
  onPick: (id: string | null) => void;
  onToggle: (id: string) => void;
  onCompare: () => void;
}) {
  const laid = layoutRounds(rounds);
  const byId = new Map(rounds.map((r) => [r.id, r]));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="size-4 text-muted-foreground" />
            Rounds
          </CardTitle>
          {selected.length > 0 && (
            <Button size="sm" disabled={busy || selected.length < 2} onClick={onCompare}>
              {busy ? <Loader2 className="animate-spin" /> : <GitMerge />}
              {selected.length < 2 ? "Select one more" : `Compare ${selected.length}`}
            </Button>
          )}
        </div>
        <CardDescription>
          Each steer branches from the round you were viewing. Tick two or more to weigh them against each other — their
          evidence is pooled and one recommendation is drawn from it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-0.5">
        {laid.map(({ round: r, depth }) => {
          const active = r.id === currentId;
          const picked = selected.includes(r.id);
          const merged = r.mergedFrom
            .map((id) => byId.get(id)?.round)
            .filter((n): n is number => typeof n === "number")
            .sort((a, b) => a - b);
          return (
            <div key={r.id} className="flex items-center gap-2 text-sm" style={{ paddingLeft: `${depth * 18}px` }}>
              {depth > 0 && <span className="select-none text-muted-foreground">└</span>}
              <input
                type="checkbox"
                checked={picked}
                onChange={() => onToggle(r.id)}
                aria-label={`Select round ${r.round} to compare`}
                className="size-3.5 shrink-0 cursor-pointer accent-primary"
              />
              <button
                onClick={() => onPick(r.id === latestId ? null : r.id)}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2 py-1 text-left transition-colors ${
                  active ? "border-primary bg-primary/10" : "border-transparent hover:border-primary/40"
                }`}
              >
                <span className={`shrink-0 ${active ? "font-medium" : ""}`}>Round {r.round}</span>
                {merged.length > 0 && (
                  <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
                    <GitMerge className="size-3" />
                    {merged.join("+")}
                  </Badge>
                )}
                {r.status !== "completed" && r.status !== "failed" && <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />}
                {r.status === "failed" && <Badge variant="destructive" className="shrink-0 text-[10px]">failed</Badge>}
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {r.direction ?? (merged.length > 0 ? "reconciling the avenues above" : "the original line of enquiry")}
                </span>
                {r.score !== null && <span className="shrink-0 text-xs text-muted-foreground">{r.score}</span>}
              </button>
            </div>
          );
        })}
        {currentId !== latestId && (
          <button onClick={() => onPick(null)} className="mt-1 self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
            back to latest
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function ResearchCard({ research }: { research: ResearchRecord }) {
  const { counts, citation } = research;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="size-4 text-muted-foreground" />
          Research
        </CardTitle>
        <CardDescription>
          The problem was broken into questions and each was worked across your documents, the project&apos;s knowledge, and the
          web — over {research.rounds} round{research.rounds === 1 ? "" : "s"}, chasing whatever came back thin.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge variant="secondary">{counts.document} document</Badge>
          <Badge variant="secondary">{counts.knowledge} knowledge</Badge>
          <Badge variant="secondary">{counts.web} web</Badge>
          {citation && (
            <Badge variant={citation.coverage >= 80 ? "success" : citation.coverage >= 50 ? "warning" : "destructive"}>
              {citation.coverage}% of claims cited
            </Badge>
          )}
          {citation && citation.unknownRefs.length > 0 && <Badge variant="destructive">invented refs: {citation.unknownRefs.join(", ")}</Badge>}
        </div>
        <div className="flex flex-col gap-1.5">
          {research.questions.map((q, i) => (
            <div key={i} className="flex items-start gap-2">
              {q.found > 0 ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
              ) : (
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              )}
              <div className="min-w-0 flex-1">
                <span>{q.question}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {q.found > 0 ? `${q.found} source${q.found === 1 ? "" : "s"}` : "nothing found"}
                </span>
              </div>
            </div>
          ))}
        </div>

        {research.blocked?.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <ShieldAlert className="size-3.5 text-amber-500" />
              {research.blocked.length} source{research.blocked.length === 1 ? " was" : "s were"} found but couldn&apos;t be read
            </div>
            <p className="text-xs text-muted-foreground">
              These sit behind access controls, so they were skipped rather than worked around — nothing here was cited.
            </p>
            {research.blocked.map((b, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs">
                <Badge variant="outline" className="shrink-0 text-[10px]">{BLOCK_LABEL[b.reason] ?? b.reason}</Badge>
                <a href={b.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-muted-foreground underline underline-offset-2 hover:text-foreground">
                  {b.url}
                </a>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EvidenceCard({ evidence }: { evidence: Evidence[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4 text-muted-foreground" />
          Evidence &amp; sources
        </CardTitle>
        <CardDescription>Every claim in the answer is cited to one of these — traceable back to your own data or the web.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {evidence.map((e) => (
          <div key={e.id} className="flex gap-2">
            <Badge variant="secondary" className="h-fit shrink-0">{e.id}</Badge>
            <div className="min-w-0">
              <span>{e.snippet}</span>
              <span className="ml-1 text-xs text-muted-foreground">
                (
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
                    {e.source}
                  </a>
                ) : (
                  e.source
                )}
                )
              </span>
              <Badge variant="outline" className="ml-1.5 text-[10px]">{e.kind}</Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DownloadBar({ base, solutionId }: { base: string; solutionId: string }) {
  // Download the round on screen, not whichever happens to be newest.
  const link = (q: string) => `${base}/download?${q}&solutionId=${solutionId}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button asChild size="sm">
        <a href={link("doc=report&format=pdf")}>
          <FileText />
          Report
        </a>
      </Button>
      <Button asChild size="sm" variant="outline">
        <a href={link("doc=deck")}>
          <Presentation />
          Deck
        </a>
      </Button>
      <Button asChild size="sm" variant="outline">
        <a href={link("doc=model")}>
          <FileSpreadsheet />
          Model
        </a>
      </Button>
      <Button asChild size="sm" variant="outline">
        <a href={link("doc=onepager&format=pdf")}>
          <Download />
          One-pager
        </a>
      </Button>
      <a className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" href={link("doc=report&format=docx")}>
        Word
      </a>
      <a className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" href={link("doc=report&format=md")}>
        Markdown
      </a>
    </div>
  );
}

function ProblemCard({ problem }: { problem: Problem }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="size-4 text-primary" />
          The problem
        </CardTitle>
        {problem.whyItMatters && <CardDescription>{problem.whyItMatters}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p className="font-medium">{problem.coreProblem}</p>
        {problem.decision && (
          <p>
            <span className="text-muted-foreground">Decision:</span> {problem.decision}
          </p>
        )}
        {problem.solutionCriteria.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground">A good solution must</div>
            <ul className="mt-1 flex flex-col gap-1">
              {problem.solutionCriteria.map((c, i) => (
                <li key={i}>• {c}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SolutionCard({ model, verification }: { model: SolutionModel; verification: Verification | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{model.title || "Solution"}</CardTitle>
        {model.recommendation && (
          <CardDescription className="text-foreground">
            <span className="font-semibold">Recommendation:</span> {model.recommendation}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        {model.executiveSummary && (
          <Section title="Executive summary">
            <p>{model.executiveSummary}</p>
          </Section>
        )}
        {model.findings.length > 0 && (
          <Section title="Findings">
            <ul className="flex flex-col gap-2">
              {model.findings.map((f, i) => (
                <li key={i}>
                  <span className="font-medium">{f.title}</span>
                  {f.detail && <span className="text-muted-foreground"> — {f.detail}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {model.analysis.length > 0 && (
          <Section title="Analysis">
            <ul className="flex flex-col gap-1">
              {model.analysis.map((a, i) => (
                <li key={i}>• {a.point}{a.evidence ? <span className="text-muted-foreground"> — {a.evidence}</span> : null}</li>
              ))}
            </ul>
          </Section>
        )}
        {model.risks.length > 0 && (
          <Section title="Risks">
            <ul className="flex flex-col gap-1">
              {model.risks.map((r, i) => (
                <li key={i}>• {r.risk}{r.mitigation ? <span className="text-muted-foreground"> → {r.mitigation}</span> : null}</li>
              ))}
            </ul>
          </Section>
        )}
        {model.plan.length > 0 && (
          <Section title="Plan">
            <ol className="flex list-decimal flex-col gap-1 pl-4">
              {model.plan.map((p, i) => (
                <li key={i}>
                  <span className="font-medium">{p.step}</span>
                  {p.owner && <span className="text-muted-foreground"> ({p.owner})</span>}
                  {p.detail && <span className="text-muted-foreground"> — {p.detail}</span>}
                </li>
              ))}
            </ol>
          </Section>
        )}
        {model.metrics.length > 0 && (
          <Section title="Key metrics">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {model.metrics.map((m, i) => (
                <div key={i} className="rounded-md border p-2">
                  <div className="text-xs text-muted-foreground">{m.name}</div>
                  <div className="text-base font-semibold tabular-nums">{m.value}</div>
                  {m.note && <div className="text-xs text-muted-foreground">{m.note}</div>}
                </div>
              ))}
            </div>
          </Section>
        )}
        {verification && !verification.solvesProblem && verification.gaps.length > 0 && (
          <Section title="Known gaps">
            <ul className="flex flex-col gap-1 text-muted-foreground">
              {verification.gaps.map((g, i) => (
                <li key={i}>• {g}</li>
              ))}
            </ul>
          </Section>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function Loading({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label ?? "Loading…"}
    </div>
  );
}
