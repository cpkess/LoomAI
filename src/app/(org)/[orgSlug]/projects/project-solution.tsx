"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileText, Loader2, Presentation, Sparkles, Target } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
interface SolutionState {
  id: string;
  status: string;
  iteration: number;
  problem: Problem | null;
  model: SolutionModel | null;
  verification: Verification | null;
}

const STATUS_LABEL: Record<string, string> = {
  diagnosing: "Diagnosing the real problem…",
  solving: "Producing the solution…",
  verifying: "Checking it solves the problem…",
  revising: "Closing gaps…",
};

export function ProjectSolution({ orgSlug, projectId }: { orgSlug: string; projectId: string }) {
  const base = `/api/orgs/${orgSlug}/projects/${projectId}/solution`;
  const [sol, setSol] = useState<SolutionState | null | undefined>(undefined);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(base);
    if (res.ok) setSol((await res.json()).solution);
  }, [base]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [load]);

  async function solve() {
    setStarting(true);
    const res = await fetch(base, { method: "POST" });
    setStarting(false);
    if (!res.ok) {
      toast.error("Could not start");
      return;
    }
    toast.success("Solving — diagnosing the core problem first");
    void load();
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
          <Button onClick={solve} disabled={starting}>
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
        {sol.iteration > 0 && <Badge variant="outline">revision {sol.iteration}</Badge>}
        <div className="ml-auto flex items-center gap-2">
          {sol.model && <DownloadBar base={base} />}
          <Button size="sm" variant="outline" onClick={solve} disabled={starting || Boolean(running)}>
            {starting ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Re-solve
          </Button>
        </div>
      </div>

      {sol.problem && <ProblemCard problem={sol.problem} />}

      {sol.model ? (
        <SolutionCard model={sol.model} verification={sol.verification} />
      ) : running ? (
        <Loading label={STATUS_LABEL[sol.status]} />
      ) : null}
    </div>
  );
}

function DownloadBar({ base }: { base: string }) {
  const link = (q: string) => `${base}/download?${q}`;
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
