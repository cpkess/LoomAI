# LoomAI

**An open, local-first AI workspace platform for organizations — run your company's AI on your own models and infrastructure.**

LoomAI turns an organization into a hybrid human + AI company. Alongside your human members you **hire AI employees**: agents with job titles, a place in the org chart, a persona, a model, and their own knowledge. Departments (workspaces) group people, agents, chats, and documents. LM Studio is a first-class inference engine; any OpenAI-style API works too.

## Features

- **AI corporation model** — AI employees with job titles, reporting lines (to humans or other agents), and department staffing; a live org chart of humans and AI side by side. Humans and AI employees share a single **People & org chart** page — an org-chart view plus a directory where AI employees are hired, edited, paused, and offboarded inline.
- **Agent permissions & Board governance** — AI employees can be granted real authority over the company: hiring, editing, and offboarding AI employees, creating departments, and changing staffing, exercised via tool calls in chat ("hire a QA engineer" actually hires one). Per action type, org Settings decide whether it runs **autonomously** or **requires Board approval** (organization admins are the Board). Gated proposals land in the **Board room**; approving one executes the stored plan immediately, and every action — autonomous or approved — is written to the audit log. Defaults are safe (structural changes need the Board) and tunable toward full day-to-day autonomy.
- **Web research (free, no API keys)** — agents granted the `web_research` capability get three tools: `web_search` (DuckDuckGo, key-less), `web_open` (fetch a page's text + links and follow links step by step — manual navigation), and `web_browse` (a real headless Chromium that runs JavaScript, for single-page apps and JS-rendered sites). No paid APIs, no rate limits; speed is traded for reach. Chromium ships in the Docker image; for bare `npm run dev`, point `LOOMAI_CHROMIUM_PATH` at a local Chrome/Chromium (or rely on `web_open`).
- **Board room inbox** — when a delegated task or project finishes, the coordinating AI employee **emails** the Board the final deliverable. The Board room has an **Inbox** tab alongside **Approvals**; unread mail shows on the sidebar badge, and each email carries the Copy / Add-to-knowledge actions. New work defaults to the **CEO** (the top of the AI org chart), so the Board can just hand off.
- **Projects with milestones & review gates** — bigger, longer initiatives. A project manager (default: the CEO) plans a project into an ordered set of **milestones**, each with a **gate**: an `auto` gate flows straight through when its tasks finish, while a **review gate** pauses the project for the Board to **approve or request changes**. Requesting changes reopens the milestone with a revision task; approving advances to the next. Milestones are expanded into tasks only when they become active, so feedback and results from earlier gates shape the planning of later ones — the project gets smarter as it runs. Each milestone reports its deliverable up, and the manager writes an executive summary when the whole project completes. You can add tasks to a project at any time (they join the active milestone, or open a follow-up one).
- **Company-wide knowledge that compounds** — every AI employee automatically retrieves across the *entire* organization knowledge base; there is no per-agent or per-department assignment to manage. The company **constantly learns**: task deliverables, every completed milestone, project summaries, and substantive AI-employee chat answers are all captured into a "Company Knowledge" collection so future work builds on them (toggle in Settings, on by default). Capture is kept clean and cheap by two *programmatic* gates — a heuristic candidacy filter drops trivial/failed outputs before any model runs, and embedding-based **dedup** skips near-duplicates so the base grows without bloating.
- **Tuned for capable local models** — generation is calibrated for the ~27B class (e.g. Gemma 3 27B): low temperatures where consistency matters (planning, summaries, knowledge extraction), more room for open-ended work and chat, a larger retrieval budget, and deeper project/delegation plans. Every knob is overridable per-deployment via env vars (`LOOMAI_TEMP_*`, `LOOMAI_MAXTOK_*`, `LOOMAI_RETRIEVAL_TOPK`, `LOOMAI_MAX_MILESTONES`, …) so a smaller or larger model can be retuned without code changes.
- **Hierarchical delegation** — hand a task to any AI employee from the Tasks page. Managers decompose it into subtasks (JSON plan), route each to the best-suited direct report, workers execute with their own persona/model/knowledge, and the manager aggregates the final deliverable. Coordinators and workers can invoke their granted company actions during a task (so "hire a QA engineer" actually hires, subject to governance). Agents without reports (or with an unparseable plan) complete tasks solo, so weaker local models degrade gracefully. If a model rejects a tool-call request (many local models return HTTP 400 "Bad Request" when handed tools they don't support), the engine automatically retries the step without tools rather than failing the task; only when that also fails does the task surface a **detailed** error (the provider's actual message, the model name, and how to fix it) instead of a terse "Bad Request". To keep runs fast and consistent, the engine also **skips redundant model calls where an algorithm suffices** — a single-subtask plan uses the worker's result verbatim instead of a separate aggregation pass, milestone gates are decided in code, and knowledge candidacy/dedup are pure functions. Every step is persisted (`agent_tasks`) and streamed to the UI.
- **Task feedback loop** — after a task finishes, follow up with plain-language feedback ("you only described the hire — actually do it"). The coordinator re-engages with the full task history and its tools and continues to completion. Feedback and results are kept as a per-task history log.
- **Task activity timeline** — every step of a task (delegation plan, each subtask result, aggregated deliverable, and feedback) is recorded as a single activity log that every agent working the task reads first, so context is never lost — workers see the full parent goal and their peers' results. The Tasks UI renders it as a clear chronological timeline (planned → subtasks → result → feedback → revised result), with the current deliverable highlighted and superseded drafts marked. Replying with feedback puts the coordinator back to work (with a live "working" indicator) and appends the revised result.
- **Reuse any output** — every employee-generated output (chat messages, task deliverables, subtask results) has a one-click **Copy** button and an **Add to knowledge base** button that saves it as a document into an existing or new collection, running it through the same chunk → embed → pgvector pipeline so agents can retrieve it later.
- **Local-first providers** — LM Studio (native `/api/v0` catalog, health, auto-discovery of local servers), Ollama, Anthropic, and any OpenAI-compatible endpoint (OpenAI, OpenRouter, Azure, vLLM…). Providers are plugins behind one interface: switching engines never touches app code.
- **Multi-tenant** — organizations are fully isolated; roles are platform admin → org admin → workspace manager → member, enforced by a central `authorize()` layer.
- **Streaming chat** — department conversations with any enabled model or AI employee, markdown rendering, history, auto-titles, token accounting.
- **Knowledge / RAG** — collections of PDFs, DOCX, Markdown, text, HTML; chunked, embedded through your providers, stored in pgvector, retrieved into every chat and agent org-wide with source citations. No assignment needed — all employees see all knowledge.
- **Prompt library** — reusable prompts with `{{variables}}`, categories, and version history; agent personas draw from it.
- **Admin surfaces** — platform: providers, models, organizations, live health + ingestion queue. Org: members & roles, departments, people & org chart (with AI-employee management), knowledge, prompts.

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

## Architecture

```
src/lib/ai         provider plugins (lmstudio, ollama, anthropic, openai-compatible) + registry
src/lib/agents     AI-employee resolution (persona+model+knowledge → chat config), org chart, delegation engine
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
