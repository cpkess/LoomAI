#!/usr/bin/env node
// Solution-quality eval.
//
// The recurring complaint about output like this is "it's inconsistent" — which
// is unmeasurable until you run the same brief several times and look at the
// spread. So this runs each fixture N times against a LIVE server and reports
// both the average and the variance of:
//
//   completed     did the run finish at all (parse failures now fail loudly,
//                 so this catches them instead of them hiding as empty output)
//   coverage      % of material claims carrying a citation
//   score         the verifier's score
//   evidence      how many sources the research phase gathered
//   unanswered    research questions nothing was found for
//   badRefs       citations pointing at evidence that does not exist
//
// Usage:  node scripts/eval.mjs [--repeat 3] [--base http://localhost:3000]
//         [--org acme] [--email ...] [--password ...] [--json out.json]
//
// Requires the app running and a browser for login (playwright-core).
import { writeFileSync } from "node:fs";

import { chromium } from "playwright-core";

import { FIXTURES } from "./eval-fixtures.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = arg("base", process.env.LOOMAI_EVAL_BASE ?? "http://localhost:3000");
const ORG = arg("org", process.env.LOOMAI_EVAL_ORG ?? "acme");
const EMAIL = arg("email", process.env.LOOMAI_EVAL_EMAIL ?? "admin@loomai.local");
const PASSWORD = arg("password", process.env.LOOMAI_EVAL_PASSWORD ?? "loomai-admin");
const REPEAT = Number(arg("repeat", 3));
const JSON_OUT = arg("json", null);
const ONLY = arg("only", null);

const chromePath =
  process.env.LOOMAI_CHROMIUM_PATH ??
  (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium-1194/chrome-linux/chrome` : undefined);

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const stddev = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const pct = (x) => `${x.toFixed(0)}%`;
const one = (x) => x.toFixed(1);

async function waitFor(check, { tries = 90, delay = 2000 }) {
  for (let i = 0; i < tries; i++) {
    const result = await check();
    if (result) return result;
    await new Promise((r) => setTimeout(r, delay));
  }
  return null;
}

/** One full run of one fixture: fresh project, sources, solution. */
async function runOnce(api, fixture) {
  const started = Date.now();
  let res = await api.post(`${BASE}/api/orgs/${ORG}/projects`, { data: { prompt: fixture.prompt } });
  if (!res.ok()) throw new Error(`create project failed: ${res.status()}`);
  const projectId = (await res.json()).project.id;

  for (const source of fixture.sources) {
    await api.post(`${BASE}/api/orgs/${ORG}/projects/${projectId}/sources`, { data: source });
  }

  // Let ingestion and analysis settle so retrieval has something to find.
  await waitFor(async () => {
    const r = await api.get(`${BASE}/api/orgs/${ORG}/projects/${projectId}/sources`);
    const list = (await r.json()).sources ?? [];
    return list.length >= fixture.sources.length && list.every((s) => s.status !== "pending") ? list : null;
  }, { tries: 40 });

  await api.post(`${BASE}/api/orgs/${ORG}/projects/${projectId}/solution`, { data: { research: true } });

  const sol = await waitFor(async () => {
    const r = await api.get(`${BASE}/api/orgs/${ORG}/projects/${projectId}/solution`);
    const s = (await r.json()).solution;
    return s && (s.status === "completed" || s.status === "failed") ? s : null;
  }, { tries: 120 });

  if (!sol) return { completed: false, error: "timed out", seconds: (Date.now() - started) / 1000 };

  const research = sol.research ?? null;
  const model = sol.model ?? {};
  const claims = [...(model.findings ?? []), ...(model.analysis ?? []), ...(model.metrics ?? [])].length;

  return {
    completed: sol.status === "completed",
    error: sol.error ?? null,
    seconds: (Date.now() - started) / 1000,
    coverage: research?.citation?.coverage ?? 0,
    badRefs: research?.citation?.unknownRefs?.length ?? 0,
    score: sol.verification?.score ?? 0,
    solves: Boolean(sol.verification?.solvesProblem),
    evidence: (sol.evidence ?? []).length,
    rounds: research?.rounds ?? 0,
    unanswered: (research?.questions ?? []).filter((q) => q.found === 0).length,
    questions: (research?.questions ?? []).length,
    blocked: (research?.blocked ?? []).length,
    claims,
    // A recommendation that never appears is the classic silent-failure shape.
    hasRecommendation: Boolean((model.recommendation ?? "").trim()),
  };
}

const browser = await chromium.launch(chromePath ? { executablePath: chromePath } : {});
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(60_000);

try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  const fixtures = ONLY ? FIXTURES.filter((f) => f.id === ONLY) : FIXTURES;
  if (fixtures.length === 0) throw new Error(`no fixture matching --only ${ONLY}`);

  console.log(`\nEval: ${fixtures.length} fixture(s) x ${REPEAT} run(s) against ${BASE}\n`);
  const report = [];

  for (const fixture of fixtures) {
    const runs = [];
    for (let i = 0; i < REPEAT; i++) {
      process.stdout.write(`  ${fixture.id} run ${i + 1}/${REPEAT} … `);
      try {
        const run = await runOnce(page.request, fixture);
        runs.push(run);
        console.log(
          run.completed
            ? `ok  coverage ${pct(run.coverage)}  score ${run.score}  evidence ${run.evidence}  ${one(run.seconds)}s`
            : `FAILED (${run.error ?? "unknown"})`
        );
      } catch (err) {
        runs.push({ completed: false, error: err.message, seconds: 0 });
        console.log(`ERROR ${err.message}`);
      }
    }

    const ok = runs.filter((r) => r.completed);
    const summary = {
      fixture: fixture.id,
      runs: runs.length,
      completedRate: (ok.length / runs.length) * 100,
      coverage: { mean: mean(ok.map((r) => r.coverage)), sd: stddev(ok.map((r) => r.coverage)) },
      score: { mean: mean(ok.map((r) => r.score)), sd: stddev(ok.map((r) => r.score)) },
      evidence: { mean: mean(ok.map((r) => r.evidence)), sd: stddev(ok.map((r) => r.evidence)) },
      unanswered: mean(ok.map((r) => r.unanswered)),
      badRefs: ok.reduce((s, r) => s + r.badRefs, 0),
      missingRecommendation: ok.filter((r) => !r.hasRecommendation).length,
      seconds: mean(runs.map((r) => r.seconds)),
      raw: runs,
    };
    report.push(summary);
  }

  console.log(`\n${"fixture".padEnd(18)}${"done".padEnd(7)}${"coverage".padEnd(16)}${"score".padEnd(15)}${"evidence".padEnd(14)}${"unans".padEnd(7)}badRefs`);
  console.log("-".repeat(88));
  for (const r of report) {
    console.log(
      r.fixture.padEnd(18) +
        pct(r.completedRate).padEnd(7) +
        `${pct(r.coverage.mean)} ±${r.coverage.sd.toFixed(1)}`.padEnd(16) +
        `${one(r.score.mean)} ±${r.score.sd.toFixed(1)}`.padEnd(15) +
        `${one(r.evidence.mean)} ±${r.evidence.sd.toFixed(1)}`.padEnd(14) +
        one(r.unanswered).padEnd(7) +
        String(r.badRefs)
    );
  }

  const allOk = report.every((r) => r.completedRate === 100);
  const anyBadRefs = report.some((r) => r.badRefs > 0);
  const anyMissing = report.some((r) => r.missingRecommendation > 0);
  console.log(
    `\n${allOk ? "All runs completed." : "SOME RUNS FAILED."}` +
      `${anyBadRefs ? " Invented citations were produced." : ""}` +
      `${anyMissing ? " Some runs produced no recommendation." : ""}`
  );
  console.log("The ± figures are the point: a wide spread means inconsistent output, not a bad average.\n");

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, repeat: REPEAT, at: new Date().toISOString(), report }, null, 2));
    console.log(`Wrote ${JSON_OUT}`);
  }

  process.exitCode = allOk && !anyBadRefs ? 0 : 1;
} finally {
  await browser.close();
}
