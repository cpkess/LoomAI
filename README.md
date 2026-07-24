# LoomAI

**Paste a brief. Get the whole package. Nothing leaves your machine.**

LoomAI turns a rough brief into a complete, consistent, decision-ready output package — a report, a slide deck, a spreadsheet model, and a one-pager — produced entirely on **your own local model, offline.** The superpower is the **Solution engine**: it diagnoses the *real* problem behind your brief, produces **one** structured answer, verifies that the answer actually solves the problem, and renders that single source into every format — so the deck, the memo, and the model can never disagree. It makes a model you can run on a laptop punch like a small team, without a byte of confidential data touching the cloud.

### The one flow: brief → problem → solution → package
1. **Diagnose** — a strategist subagent finds the core problem to solve (often not the literal ask), the decision to make, and what "solved" looks like.
2. **Deep research** *(optional, on by default)* — the problem is **broken into specific research questions**, and each is worked across three channels: the project's own documents (scored chunk retrieval), its structured knowledge (attributed to the source it was extracted from), and the **live web**. Questions that come back thin get **sharper follow-up queries and another round**. Findings are deduped, ranked with per-channel quotas, and numbered `[E#]`. See [Sourcing you can check](#sourcing-you-can-check).
3. **Solve** — one structured **Solution** is produced in three stages, deliberately in this order: what the **evidence supports** (findings and analysis), then the **recommendation derived from it**, then the **risks, plan and metrics** that follow. Writing the conclusion in the same breath as the findings is what lets a model assert a recommendation its own evidence doesn't support; sequencing forces derivation. Every claim is **cited `[E#]`**.
4. **Verify** — a reviewer checks the answer against the diagnosed problem and its success criteria *and against its evidence*: citations are validated (invented `[E#]` refs are stripped and fail the check), grounding is measured, and unanswered research questions are surfaced as known blind spots. It revises until it passes (or hits the iteration cap).
5. **Render** — that one Solution downloads as a **Report** (PDF/Word/HTML/Markdown), a **Deck** (`.pptx`), a **Model** (`.xlsx`), and a **One-pager** — every format carries the same recommendation *and* a **Sources** section, so they're consistent and auditable. Change the brief, re-solve, and every format updates in lockstep.

Everything below is how the project builds the context and evidence the Solution stands on. There is no AI org chart — projects spin up **ephemeral subagents** (a persona for one task, gone when done), so it all works with zero setup. LM Studio is a first-class inference engine; any OpenAI-style API works too.

### Sourcing you can check

A citation is only worth something if you can follow it. These rules make that true:

- **The model never supplies a URL.** LoomAI runs the search itself, fetches the actual pages, and asks the model only to extract claims *from text it was handed*. The URL and title come from the fetch, so a web citation always points at a page that exists and really said it. If a page won't load, its real search-result snippet is kept (scored lower) rather than the source being dropped.
- **Local evidence names its real origin.** Knowledge items cite the document or note they were extracted from — *"Q3 board deck (project knowledge)"* — not a generic label, resolved through the knowledge item's recorded provenance.
- **Citations are validated, not trusted.** After the solve, `[E#]` tags are checked against the evidence that actually exists: invented references are stripped from the output, grounding is measured (*"60% of claims cited"*), and a solution that cited nonexistent evidence **fails verification and goes back for revision** regardless of how good the prose read.
- **Obstacles and gates are treated differently.** Cookie/consent banners and pop-up overlays are dismissed automatically so the content behind them can be read — the same click a person makes on arrival. **Access controls are not touched:** a CAPTCHA, bot wall, login, or paywall is *detected and reported*, never solved or worked around. The source is recorded as unreachable, nothing is cited from it, and the run moves on without retrying. That way "no evidence exists" is never confused with "we couldn't get in" — and the blocked sources are listed in the UI *and in the exported report*, so a reader knows exactly what the answer does and doesn't cover. If you need what's behind a wall, the answer is credentials or an API, not a bypass.
- **LoomAI is a polite client.** It honours `robots.txt` (including `Crawl-delay`), identifies itself truthfully in its User-Agent, and paces itself per host so research never hammers a site it's about to cite.
- **The brief is not evidence.** A project's own prompt is filed as its first source, so it used to be retrievable — and citable — as support for its own answer. It's now excluded from the evidence pool: citing the question as proof of the answer is circular.
- **Retrieval is hybrid, and evidence clears a higher bar.** Vector similarity is fused with postgres full-text ranking (reciprocal rank fusion), because exact terms — product names, figures, acronyms — are what research questions actually turn on and pure embeddings miss them. Evidence must then clear `LOOMAI_EVIDENCE_MIN_SIM` (0.45, versus 0.2 for chat retrieval): a barely-related chunk carrying an `[E#]` tag looks grounded while adding nothing, which is worse than no evidence at all.
- **Failures are loud.** Structured steps retry once with the parser's complaint fed back, then **fail the run**. They no longer fall back to an empty solution or — worse — a verification that defaults to "passes" for a review that never happened. A visible failure is recoverable; silent bad output isn't.

The Solution tab shows the whole research record — each question, how many sources it turned up, which ones came back empty, per-channel counts, and the citation coverage — so you can see where the answer is well-founded and where it's thin. Tunable via `LOOMAI_RESEARCH_ROUNDS`, `LOOMAI_RESEARCH_QUESTIONS`, `LOOMAI_RESEARCH_MAX_EVIDENCE`, `LOOMAI_RESEARCH_WEB_PAGES`, `LOOMAI_RESEARCH_CONCURRENCY`.

## Three pillars (the machinery behind the Solution)

### 1. World-class context collection
- **Ingest almost anything** — PDFs, Word (`.docx`), **PowerPoint (`.pptx`)**, **Excel (`.xlsx`)**, Markdown, HTML, text/CSV/JSON, **images**, **transcripts (`.vtt`/`.srt`)**, **ZIP archives**, and **web pages by URL**. Parsers preserve structure and provenance — slides become `## Slide N` with speaker notes, workbooks become per-sheet tables, archives expand and ingest each supported entry — and record metadata (source kind, slide/sheet counts, filename) on every document.
- **Everything flows into project memory** — an added source is ingested into the project's own RAG collection (chunk → embed → pgvector) so deliverables can retrieve it, and queued for knowledge extraction. Uploads keep their original file (metadata preserved) while the extracted text feeds the knowledge graph.
- *(Scaffolded next: audio/meeting-recording transcription, image OCR, full git-repo import — the parser pipeline is pluggable.)*

### 2. Living project intelligence
- **A project is just a prompt space** — describe what you want to solve and the project is created from it: the prompt becomes the project's brief (and its first source), the title is derived from your words, and the project opens straight to its **Solution**. No forms, no setup. When you want a structured plan, open **Re-scope** in Overview: a strategist subagent drafts a **work plan** (objective, success criteria, scope in/out, audience, key questions, assumptions, risks, approach, planned deliverables, evidence to gather), refines it with you, and on acceptance **seeds the knowledge graph** (the objective becomes a decision; open questions, assumptions, and risks become live items) so gaps and suggested investigations are populated and planned deliverables are one-click to generate.
- **An evolving understanding, not a folder** — each source is automatically analyzed: an extraction subagent pulls typed **knowledge items** — facts, claims, insights, assumptions, decisions, questions, risks — embeds them, and **reconciles** them against what's already known. Matching evidence *reinforces* an item (bumping confidence, refreshing its timestamp); conflicting evidence creates a **`contradicts`** edge and marks the weaker item **challenged**; a source that answers a **question** resolves it.
- **Provenance & history** — every item carries the exact evidence snippets it came from, the typed relationships (`supports` / `contradicts` / `answers` / `refines` / `supersedes` / `raises`) that connect it, and a full timeline of how it evolved. Every decision is traceable.
- **Time-aware** — items go **stale** past a per-type interval (risks 30 days, assumptions 60, facts 180 — all env-tunable) and are flagged on open. Analysis is **event-driven and on-open** — no scheduler.
- **Proactive** — the **Overview** greets you like a collaborator who remembers everything: what changed since your last visit, **emerging themes** (clusters in the knowledge graph), **missing information** (open questions and thin-evidence claims), unresolved contradictions, stale knowledge, risks, **suggested next investigations**, recommended next steps, and a timeline.
- **Project chat** — ask a per-project assistant grounded in that project's sources and knowledge, with cited answers.

### 3. Exceptional artifact generation
- **Grounded in the prompt and scope** — every deliverable is generated against the project's **objective and scope** (from the work plan): the planner, writers, and critic all see the objective, audience, in/out-of-scope, success criteria, and key questions, so the output stays on-target and in-scope even before many sources exist. Generate a deliverable with just a title and it inherits the project's objective as its brief.
- **Orchestrated, not one prompt** — reports, strategies, PRDs, research summaries, proposals, memos, executive summaries, and decision memos are produced by a multi-stage pipeline: a **planner** drafts a living outline grounded in the project's knowledge and scope; **writers** draft each section; a **critic** and **gap-analysis** review for unsupported claims, weak arguments, inconsistent terminology, goal/scope drift, and missing/redundant coverage; sections that fail **configurable quality gates** (max issues per section, no blocking issues, iteration cap) go back to an **editor** and are re-reviewed until the gates pass or the cap is hit; then approved sections are **deterministically assembled**.
- **Specialist subagents** — planner, researcher, writer, editor, proofreader, continuity, critic, gap-analysis — each a built-in persona a project spins up on demand. The researcher can use free web tools when web research is enabled.
- **Native formats, tailored per kind** — beyond Markdown/PDF/Word/HTML, structured kinds plan a **typed spec** and render a real binary: **presentations** → `.pptx` (pptxgenjs) and **workbooks** → `.xlsx` (exceljs). Each artifact type uses a workflow tuned to its format instead of treating everything as text.
- **Resumable & observable** — the engine is DB-state-driven and re-entrant (one bounded step per tick, resumes cleanly after a restart). The **Deliverable** view shows the assembled document, the outline tree with per-section status and **Regenerate**, native download, and a **production log** of every step. On completion, insights fold **back into the project's knowledge** (loop closure).

## Platform

- **Web research (free, no API keys)** — the researcher subagent gets four tools: `web_search` (DuckDuckGo, key-less), `web_open` (fetch a page's text + links and follow them step by step), `web_browse` (a real headless Chromium that runs JavaScript), and `web_navigate` (the same browser, but it also clears cookie/consent banners and pop-up overlays, and reports a gated page as blocked instead of returning nothing). Chromium ships in the Docker image; for bare `npm run dev`, point `LOOMAI_CHROMIUM_PATH` at a local Chrome/Chromium (or rely on `web_open`). Toggle in Settings. Pacing and timeouts: `LOOMAI_NAV_HOST_INTERVAL_MS`, `LOOMAI_NAV_TIMEOUT_MS`.
- **Knowledge that compounds** — each project keeps its own scoped knowledge graph; substantive chat answers are captured back into that project's knowledge (heuristic-gated and embedding-deduped, on by default) so later work in the project builds on them. Knowledge lives per project — there is no central library.
- **Tuned for capable local models** — calibrated for a ~32k-context local model (e.g. Gemma 3 27B): low temperatures where consistency matters (planning, extraction, summaries), generous budgets for long-form work, a large retrieval budget (12 chunks). Every knob is overridable via env vars (`LOOMAI_TEMP_*`, `LOOMAI_MAXTOK_*`, `LOOMAI_RETRIEVAL_TOPK`, …).
- **Real, downloadable deliverables** — prose kinds download as **PDF**, **Word (.docx)**, **Markdown**, or **HTML** rendered on the fly; structured kinds download as native **PowerPoint (.pptx)** and **Excel (.xlsx)**.
- **Local-first providers** — LM Studio (native `/api/v0` catalog, health, auto-discovery), Ollama, Anthropic, and any OpenAI-compatible endpoint (OpenAI, OpenRouter, Azure, vLLM…). Providers are plugins behind one interface.
- **Isolated tenancy, no company UI** — tenancy is kept as invisible plumbing (each tenant's projects and knowledge are fully isolated, enforced by a central `authorize()` layer), but there is no company-facing surface — no org switcher, dashboard, members, or departments. The app is just **Projects** and **Settings**, where a per-tenant **default model** (used by every subagent) is set.
- **Knowledge / RAG** — per-project collections chunked, embedded through your providers, stored in pgvector, retrieved with source citations.
- **One-click updates** — a **Software update** panel in platform admin compares the running commit to the latest on GitHub and, when enabled, pulls + rebuilds + restarts in place.
- **Admin surfaces** — platform: providers, models, organizations, software update, live health + ingestion queue. Per-tenant: project defaults (default model, web research, auto-knowledge) in Settings.

## Quickstart

**One step** (requires Docker):

```bash
docker compose up -d --build
```

That's the whole install: it builds the app, starts Postgres 17 + pgvector, generates and persists a `LOOMAI_SECRET`, runs migrations, and seeds a platform admin plus a demo organization. Then sign in at http://localhost:3000 as `admin@loomai.local` / `loomai-admin`.

Optional environment overrides: `LOOMAI_SECRET` (pin your own; otherwise one is generated on first boot and kept in the `loomai-data` volume) and `LOOMAI_ADMIN_PASSWORD` (seeded admin password).

**Development mode** (hot reload; requires Node 22+ and Docker for the database):

```bash
./setup.sh
```

The script creates `.env` with a generated secret, starts Postgres, installs dependencies, migrates, seeds, and runs `npm run dev` — same URL and login as above.

### Connect LM Studio

1. In LM Studio, start the local server (`lms server start`, default port 1234) and load a chat model plus an embedding model.
2. In LoomAI: **Platform admin → AI providers → Auto-discover LM Studio** (or add it manually).
3. Click **Sync models**, then enable the models you want.
4. Create a project, add sources, and generate a deliverable.

Any OpenAI-compatible server works the same way: add a provider with its base URL (e.g. `https://api.openai.com/v1` plus API key) and sync.

## Production notes

The same `docker compose up -d --build` is the production deployment: the app container runs migrations and (first boot only) seeding before serving on port 3000. For real deployments pin `LOOMAI_SECRET` and `LOOMAI_ADMIN_PASSWORD` in the environment. `host.docker.internal` is mapped so an LM Studio/Ollama instance on the host machine is reachable from inside the container — when registering the provider from a containerized app, use `http://host.docker.internal:1234` (Auto-discover probes it automatically).

### Updating from GitHub (one click)

The Docker image ships as a self-updating checkout, so you don't have to manually rebuild. Set `LOOMAI_SELF_UPDATE=1` on the app, then go to **Platform admin → Software update**: it shows the running commit vs. the latest on GitHub, and **Update & restart** pulls the newest source, rebuilds, runs migrations, and comes back on the new version (briefly unavailable while it rebuilds). Optional overrides: `LOOMAI_REPO_URL` (default `https://github.com/cpkess/loomai.git`) and `LOOMAI_UPDATE_REF` (default `main`). With self-update left off (the default), the page still tells you when an update is available; apply it the classic way with `git pull && docker compose up -d --build`.

## Architecture

```
src/lib/ai         provider plugins (lmstudio, ollama, anthropic, openai-compatible) + registry
src/lib/agents     ephemeral subagents (systemReply grounded generation), specialist role personas, the work queue
src/lib/projects   Solution engine (diagnose → research → solve → verify) + deep research (question decomposition, multi-round multi-channel gathering, verifiable web sourcing, ranking, citation validation) + one-source multi-format renderers; Living Projects (scoping loop + work plan, knowledge graph, event-driven analysis, staleness, intelligence, briefing, chat) + multi-stage deliverable engine + quality gates
src/lib/research   free web tools (DuckDuckGo search, fetch+links, headless-browser navigation with consent-banner dismissal, access-gate detection, robots.txt + per-host pacing)
src/lib/rag        parse (pdf/docx/pptx/xlsx/zip/images/transcripts) → chunk → embed → pgvector retrieve, in-process ingestion queue
src/lib/export     render deliverables → PDF/DOCX/HTML/Markdown, native PPTX (pptxgenjs) + XLSX (exceljs)
src/lib/auth       Auth.js credentials behind an AuthBackend interface (LDAP/OIDC pluggable), authorize()
src/lib/db         Drizzle schema + migrations (Postgres + pgvector)
src/app            Next.js App Router — (auth), (org)/[orgSlug], (platform)/admin, api/
```

Design rules the codebase follows:

- **No provider-specific logic outside `lib/ai/providers/`** — everything resolves through the registry.
- **Tenancy safety** — org-scoped queries derive the org id from the session-checked `requireOrg`/`requireWorkspace` context, never from client input.
- **Secrets at rest** — provider API keys are AES-256-GCM encrypted with `LOOMAI_SECRET`.
- **Pluggable seams** — auth backends, providers, and the ingestion pipeline are interfaces with default implementations, so LDAP/OIDC, new engines, OCR, or an external job queue slot in without core changes.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | start the dev server |
| `npm run build` / `npm start` | production build / serve |
| `npm test` | unit tests (vitest) |
| `npm run db:generate` | generate a migration after schema changes |
| `npm run db:migrate` | apply migrations |
| `npm run db:seed` | seed the platform admin + demo org |
| `npm run eval` | measure Solution quality **and run-to-run variance** (see below) |
| `npm run web:check` | check the live web path: search, fetch, consent banners, gate detection |

### Measuring quality, not vibes

"The output is inconsistent" is unfalsifiable until you run the same brief repeatedly and look at the spread, so `npm run eval` does exactly that: a few fixture briefs with a fixed corpus, run N times each against a live server, reporting the **mean and standard deviation** of citation coverage, verifier score, and evidence gathered — plus completion rate, unanswered research questions, and any invented citations.

```
npm run eval -- --repeat 5 --json eval.json
```

The ± figures are the point. A good average with a wide spread is an inconsistent system, and that's the thing to fix. Run it before and after any change to prompting, retrieval, or model choice.

`npm run web:check` is the counterpart for the web path, which can only be judged against the live internet: it exercises search, plain fetch, `robots.txt` parsing, real navigation, consent-banner dismissal, and gate detection, then tells you which parts work. If a page you know shows a cookie wall reports "no overlay found", its CMP selector is missing from `CONSENT_SELECTORS` — that list is the part most likely to need topping up over time.

## Roadmap

- More ingestion: audio/meeting-recording transcription, image OCR, full git-repo import
- More native artifacts: research papers, project plans, dashboards, meeting briefings, knowledge summaries
- A durable job runner so projects re-evaluate and sweep staleness even while unopened
- Deliverable ↔ knowledge dependency tracking (flag a deliverable when its supporting knowledge changes)
- LDAP / OIDC auth backends; usage analytics per model/org
