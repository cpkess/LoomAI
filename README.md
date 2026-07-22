# LoomAI

**An open, local-first AI workspace platform for organizations — run your company's AI on your own models and infrastructure.**

LoomAI turns an organization into a hybrid human + AI company. Alongside your human members you **hire AI employees**: agents with job titles, a place in the org chart, a persona, a model, and their own knowledge. Departments (workspaces) group people, agents, chats, and documents. LM Studio is a first-class inference engine; any OpenAI-style API works too.

## Features

- **AI corporation model** — AI employees with job titles, reporting lines (to humans or other agents), and department staffing; a live org chart of humans and AI side by side. Humans and AI employees share a single **People & org chart** page — an org-chart view plus a directory where AI employees are hired, edited, paused, and offboarded inline.
- **Agent permissions & Board governance** — AI employees can be granted real authority over the company: hiring, editing, and offboarding AI employees, creating departments, and changing staffing, exercised via tool calls in chat ("hire a QA engineer" actually hires one). Per action type, org Settings decide whether it runs **autonomously** or **requires Board approval** (organization admins are the Board). Gated proposals land in the **Board room**; approving one executes the stored plan immediately, and every action — autonomous or approved — is written to the audit log. Defaults are safe (structural changes need the Board) and tunable toward full day-to-day autonomy.
- **Web research (free, no API keys)** — agents granted the `web_research` capability get three tools: `web_search` (DuckDuckGo, key-less), `web_open` (fetch a page's text + links and follow links step by step — manual navigation), and `web_browse` (a real headless Chromium that runs JavaScript, for single-page apps and JS-rendered sites). No paid APIs, no rate limits; speed is traded for reach. Chromium ships in the Docker image; for bare `npm run dev`, point `LOOMAI_CHROMIUM_PATH` at a local Chrome/Chromium (or rely on `web_open`).
- **Board room inbox** — when a delegated task or project finishes, the coordinating AI employee **emails** the Board the final deliverable. The Board room has an **Inbox** tab alongside **Approvals**; unread mail shows on the sidebar badge, and each email carries the Copy / Add-to-knowledge actions. New work defaults to the **CEO** (the top of the AI org chart), so the Board can just hand off.
- **Living Projects — an evolving understanding, not a folder** — a project is a persistent, structured *understanding* of a problem space that grows as you feed it. Add **sources** (notes, uploaded documents, research, forwarded Board email, task output) and each one is automatically analyzed: the project manager extracts typed **knowledge items** — facts, claims, insights, assumptions, decisions, questions, risks — embeds them, and **reconciles** them against what's already known. New evidence that matches an existing item *reinforces* it (bumping confidence, refreshing its timestamp); evidence that conflicts creates a **`contradicts`** relationship and marks the weaker item **challenged**; a source that answers an open **question** resolves it. Every item carries its **provenance** — the exact evidence snippets it came from, the relationships (`supports` / `contradicts` / `answers` / `refines` / `supersedes` / `raises`) that connect it, and a full history of how it evolved. Knowledge is **time-aware**: items go **stale** past a per-type interval (risks in 30 days, assumptions in 60, facts in 180 — all env-tunable) and are flagged for review. Analysis is **event-driven and on-open** (no scheduler): sources analyze when added, staleness is computed when you open the project. Returning after months, the **Overview** greets you like a collaborator who remembers everything — what changed since your last visit, unresolved contradictions, open questions, stale assumptions, current risks, the manager's **recommended next steps**, and a timeline of how the understanding evolved.
- **Multi-Stage Deliverables — big outputs via an orchestrated AI workflow** — reports, strategies, PRDs, research summaries, proposals, and memos are produced by a **multi-agent pipeline**, not one prompt. A **planner** drafts a **living outline** grounded in the project's knowledge; each section is assigned a **specialist role** — planner, researcher, writer, editor, proofreader, continuity, critic, gap-analysis — that prefers a **hired AI employee whose title matches** the role (a "Content Strategist" writes, a "Research Analyst" researches) and always wears the role's built-in persona. **Writers** draft sections grounded in project evidence; a **critic** reviews each for unsupported claims, weak arguments, inconsistent terminology, and goal drift, while **gap-analysis** checks the whole outline for missing or redundant coverage (and can grow the outline). Sections that fail the **configurable quality gates** (max issues per section, no blocking issues, iteration cap) are sent back for **section-level revision** by an editor and re-reviewed — the loop **iterates until the gates pass** or the cap is hit — then approved sections are **deterministically assembled** into the final document. The engine is **DB-state-driven and re-entrant**, so a run advances one bounded step per tick and **resumes cleanly after a restart**. The **Deliverable** view shows the assembled document (with Copy / Download / Add-to-knowledge), the outline tree with per-section status and a **Regenerate** button, and a **production log** of every step. On completion the deliverable's insights are folded **back into the project's knowledge** (loop closure), so the next piece of work builds on it.
- **Company-wide knowledge that compounds** — every AI employee automatically retrieves across the *entire* organization knowledge base; there is no per-agent or per-department assignment to manage. The company **constantly learns**: task deliverables, completed multi-stage deliverables, and substantive AI-employee chat answers are all captured into a "Company Knowledge" collection so future work builds on them (toggle in Settings, on by default). Living Projects additionally keep their own **scoped** knowledge graph per project. Capture is kept clean and cheap by two *programmatic* gates — a heuristic candidacy filter drops trivial/failed outputs before any model runs, and embedding-based **dedup** skips near-duplicates so the base grows without bloating.
- **Tuned for capable local models** — generation is calibrated for a capable local model with a **~32k context window** (e.g. Gemma 3 27B): low temperatures where consistency matters (planning, summaries, knowledge extraction), generous token budgets for long-form work and comprehensive summaries, a large retrieval budget (12 chunks), and deeper project/delegation plans. Every knob is overridable per-deployment via env vars (`LOOMAI_TEMP_*`, `LOOMAI_MAXTOK_*`, `LOOMAI_RETRIEVAL_TOPK`, `LOOMAI_MAX_MILESTONES`, …) so a smaller-context or larger model can be retuned without code changes.
- **Hierarchical delegation** — hand a task to any AI employee from the Tasks page. Managers decompose it into subtasks (JSON plan), route each to the best-suited direct report, workers execute with their own persona/model/knowledge, and the manager aggregates the final deliverable. Coordinators and workers can invoke their granted company actions during a task (so "hire a QA engineer" actually hires, subject to governance). Agents without reports (or with an unparseable plan) complete tasks solo, so weaker local models degrade gracefully. If a model rejects a tool-call request (many local models return HTTP 400 "Bad Request" when handed tools they don't support), the engine automatically retries the step without tools rather than failing the task; only when that also fails does the task surface a **detailed** error (the provider's actual message, the model name, and how to fix it) instead of a terse "Bad Request". To keep runs fast and consistent, the engine also **skips redundant model calls where an algorithm suffices** — a single-subtask plan uses the worker's result verbatim instead of a separate aggregation pass, milestone gates are decided in code, and knowledge candidacy/dedup are pure functions. Every step is persisted (`agent_tasks`) and streamed to the UI.
- **Task feedback loop** — after a task finishes, follow up with plain-language feedback ("you only described the hire — actually do it"). The coordinator re-engages with the full task history and its tools and continues to completion. Feedback and results are kept as a per-task history log.
- **Task activity timeline** — every step of a task (delegation plan, each subtask result, aggregated deliverable, and feedback) is recorded as a single activity log that every agent working the task reads first, so context is never lost — workers see the full parent goal and their peers' results. The Tasks UI renders it as a clear chronological timeline (planned → subtasks → result → feedback → revised result), with the current deliverable highlighted and superseded drafts marked. Replying with feedback puts the coordinator back to work (with a live "working" indicator) and appends the revised result.
- **Recommends its own work** — once the company has **learned enough** (a chief AI employee plus a substantial knowledge base), the CEO proposes the highest-value next **projects and deliverables**, grounded in what the org knows. Recommendations land in the **Board room** as 💡 proposals with a rationale; approving one spins up a real **Living Project** or a deliverable task that runs autonomously — dismiss the rest. They refresh automatically after work completes and on demand via **Suggest next steps** (threshold tunable with `LOOMAI_RECOMMEND_MIN_DOCS`).
- **Real, downloadable deliverables** — every deliverable (task result, milestone, project summary, Board email, chat output) can be **downloaded** as **PDF**, **Word (.docx)**, **Markdown**, or **HTML**, converted on the fly from the stored markdown — no file storage needed. PDFs render through the same Chromium that powers web research; the other formats need no extra setup.
- **Reuse any output** — every employee-generated output (chat messages, task deliverables, subtask results) has a one-click **Copy** button and an **Add to knowledge base** button that saves it as a document into an existing or new collection, running it through the same chunk → embed → pgvector pipeline so agents can retrieve it later.
- **Local-first providers** — LM Studio (native `/api/v0` catalog, health, auto-discovery of local servers), Ollama, Anthropic, and any OpenAI-compatible endpoint (OpenAI, OpenRouter, Azure, vLLM…). Providers are plugins behind one interface: switching engines never touches app code.
- **Multi-tenant** — organizations are fully isolated; roles are platform admin → org admin → workspace manager → member, enforced by a central `authorize()` layer.
- **Streaming chat** — department conversations with any enabled model or AI employee, markdown rendering, history, auto-titles, token accounting.
- **Knowledge / RAG** — collections of PDFs, DOCX, Markdown, text, HTML; chunked, embedded through your providers, stored in pgvector, retrieved into every chat and agent org-wide with source citations. No assignment needed — all employees see all knowledge.
- **Prompt library** — reusable prompts with `{{variables}}`, categories, and version history; agent personas draw from it.
- **One-click updates** — a **Software update** panel in platform admin compares the running commit to the latest on GitHub and, when enabled, pulls + rebuilds + restarts the app in place — no manual `docker build` (see Production notes).
- **Admin surfaces** — platform: providers, models, organizations, software update, live health + ingestion queue. Org: members & roles, departments, people & org chart (with AI-employee management), knowledge, prompts.

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
4. Open a department and chat — or hire an AI employee that uses the model.

Any OpenAI-compatible server works the same way: add a provider with its base URL (e.g. `https://api.openai.com/v1` plus API key) and sync.

## Production notes

The same `docker compose up -d --build` is the production deployment: the app container runs migrations and (first boot only) seeding before serving on port 3000. For real deployments pin `LOOMAI_SECRET` and `LOOMAI_ADMIN_PASSWORD` in the environment. `host.docker.internal` is mapped so an LM Studio/Ollama instance on the host machine is reachable from inside the container — when registering the provider from a containerized app, use `http://host.docker.internal:1234` (Auto-discover probes it automatically).

### Updating from GitHub (one click)

The Docker image ships as a self-updating checkout, so you don't have to manually rebuild. Set `LOOMAI_SELF_UPDATE=1` on the app, then go to **Platform admin → Software update**: it shows the running commit vs. the latest on GitHub, and **Update & restart** pulls the newest source, rebuilds, runs migrations, and comes back on the new version (briefly unavailable while it rebuilds). Optional overrides: `LOOMAI_REPO_URL` (default `https://github.com/cpkess/loomai.git`) and `LOOMAI_UPDATE_REF` (default `main`). With self-update left off (the default), the page still tells you when an update is available; apply it the classic way with `git pull && docker compose up -d --build`.

## Architecture

```
src/lib/ai         provider plugins (lmstudio, ollama, anthropic, openai-compatible) + registry
src/lib/agents     AI-employee resolution (persona+model+knowledge → chat config), org chart, delegation engine, specialist roles
src/lib/projects   Living Projects (knowledge graph, event-driven analysis, staleness, briefing) + multi-stage deliverable engine + quality gates
src/lib/company    company actions (hire/offboard/departments/staffing), governance policy, Board approval flow
src/lib/research   free web tools for agents (DuckDuckGo search, fetch+links, headless-browser navigation)
src/lib/rag        parse → chunk → embed → pgvector retrieve, in-process ingestion queue
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

- Multi-level delegation (reports delegating onward down the chart) and agent-to-agent messaging
- Tool registry & execution (web search, SQL, REST, GitHub…) per workspace
- LDAP / OIDC auth backends
- Web-page ingestion, OCR plugin
- Usage analytics per model/org
