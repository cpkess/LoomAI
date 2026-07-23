# LoomAI

**An open, local-first intelligent operating system for knowledge work — run it on your own models and infrastructure.**

LoomAI is built around one question: *does this help you build better knowledge or create better work?* You create **projects** that continuously ingest information and build a structured, evolving understanding, then produce professional deliverables through orchestrated multi-stage AI workflows. There is no AI org chart to manage — projects spin up **ephemeral subagents** (a persona for one task, gone when done), so everything works with zero setup. LM Studio is a first-class inference engine; any OpenAI-style API works too.

## Three pillars

### 1. World-class context collection
- **Ingest almost anything** — PDFs, Word (`.docx`), **PowerPoint (`.pptx`)**, **Excel (`.xlsx`)**, Markdown, HTML, text/CSV/JSON, **images**, **transcripts (`.vtt`/`.srt`)**, **ZIP archives**, and **web pages by URL**. Parsers preserve structure and provenance — slides become `## Slide N` with speaker notes, workbooks become per-sheet tables, archives expand and ingest each supported entry — and record metadata (source kind, slide/sheet counts, filename) on every document.
- **Everything flows into project memory** — an added source is ingested into the project's own RAG collection (chunk → embed → pgvector) so deliverables can retrieve it, and queued for knowledge extraction. Uploads keep their original file (metadata preserved) while the extracted text feeds the knowledge graph.
- *(Scaffolded next: audio/meeting-recording transcription, image OCR, full git-repo import — the parser pipeline is pluggable.)*

### 2. Living project intelligence
- **Scoping loop — one prompt bootstraps the whole project** — your initial prompt launches a **scoping session**: a strategist subagent instantly drafts a structured **work plan** (objective, success criteria, scope in/out, audience, key questions, assumptions, risks, approach, planned deliverables, evidence to gather) and refines it with you in a short conversation. Accepting the plan **seeds the knowledge graph** — the objective becomes a decision, and the open questions, assumptions, and risks become live items — so the project's intelligence (gaps, suggested investigations) is populated before you add a single document, and the planned deliverables are one-click to generate. Skippable via *quick create*, and re-openable any time (*Re-scope*).
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

- **Web research (free, no API keys)** — the researcher subagent gets three tools: `web_search` (DuckDuckGo, key-less), `web_open` (fetch a page's text + links and follow them step by step), and `web_browse` (a real headless Chromium that runs JavaScript). Chromium ships in the Docker image; for bare `npm run dev`, point `LOOMAI_CHROMIUM_PATH` at a local Chrome/Chromium (or rely on `web_open`). Toggle in Settings.
- **Knowledge that compounds** — projects keep their own scoped knowledge graph; substantive chat answers are captured into a shared knowledge base (heuristic-gated and embedding-deduped, on by default) so future work builds on them.
- **Tuned for capable local models** — calibrated for a ~32k-context local model (e.g. Gemma 3 27B): low temperatures where consistency matters (planning, extraction, summaries), generous budgets for long-form work, a large retrieval budget (12 chunks). Every knob is overridable via env vars (`LOOMAI_TEMP_*`, `LOOMAI_MAXTOK_*`, `LOOMAI_RETRIEVAL_TOPK`, …).
- **Real, downloadable deliverables** — prose kinds download as **PDF**, **Word (.docx)**, **Markdown**, or **HTML** rendered on the fly; structured kinds download as native **PowerPoint (.pptx)** and **Excel (.xlsx)**.
- **Local-first providers** — LM Studio (native `/api/v0` catalog, health, auto-discovery), Ollama, Anthropic, and any OpenAI-compatible endpoint (OpenAI, OpenRouter, Azure, vLLM…). Providers are plugins behind one interface.
- **Multi-tenant** — organizations are fully isolated; roles are platform admin → org admin → workspace manager → member, enforced by a central `authorize()` layer. A per-org **default model** (used by every subagent) is set in Settings.
- **Knowledge / RAG** — collections chunked, embedded through your providers, stored in pgvector, retrieved with source citations.
- **Prompt library** — reusable prompts with `{{variables}}`, categories, and version history.
- **One-click updates** — a **Software update** panel in platform admin compares the running commit to the latest on GitHub and, when enabled, pulls + rebuilds + restarts in place.
- **Admin surfaces** — platform: providers, models, organizations, software update, live health + ingestion queue. Org: members & roles, knowledge, prompts, project defaults.

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
src/lib/projects   Living Projects (scoping loop + work plan, knowledge graph, event-driven analysis, staleness, intelligence, briefing, chat) + multi-stage deliverable engine + quality gates + deliverable kinds
src/lib/research   free web tools (DuckDuckGo search, fetch+links, headless-browser navigation)
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

## Roadmap

- More ingestion: audio/meeting-recording transcription, image OCR, full git-repo import
- More native artifacts: research papers, project plans, dashboards, meeting briefings, knowledge summaries
- A durable job runner so projects re-evaluate and sweep staleness even while unopened
- Deliverable ↔ knowledge dependency tracking (flag a deliverable when its supporting knowledge changes)
- LDAP / OIDC auth backends; usage analytics per model/org
