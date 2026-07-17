# LoomAI

**An open, local-first AI workspace platform for organizations — run your company's AI on your own models and infrastructure.**

LoomAI turns an organization into a hybrid human + AI company. Alongside your human members you **hire AI employees**: agents with job titles, a place in the org chart, a persona, a model, and their own knowledge. Departments (workspaces) group people, agents, chats, and documents. LM Studio is a first-class inference engine; any OpenAI-style API works too.

## Features

- **AI corporation model** — AI employees with job titles, reporting lines (to humans or other agents), and department staffing; a live org chart of humans and AI side by side. Hierarchical task delegation is schema-ready (`agent_tasks`) for the orchestration engine to come.
- **Local-first providers** — LM Studio (native `/api/v0` catalog, health, auto-discovery of local servers), Ollama, Anthropic, and any OpenAI-compatible endpoint (OpenAI, OpenRouter, Azure, vLLM…). Providers are plugins behind one interface: switching engines never touches app code.
- **Multi-tenant** — organizations are fully isolated; roles are platform admin → org admin → workspace manager → member, enforced by a central `authorize()` layer.
- **Streaming chat** — department conversations with any enabled model or AI employee, markdown rendering, history, auto-titles, token accounting.
- **Knowledge / RAG** — collections of PDFs, DOCX, Markdown, text, HTML; chunked, embedded through your providers, stored in pgvector, retrieved into chats with source citations. Collections attach to departments and to individual agents.
- **Prompt library** — reusable prompts with `{{variables}}`, categories, and version history; agent personas draw from it.
- **Admin surfaces** — platform: providers, models, organizations, live health + ingestion queue. Org: members & roles, departments, AI employees, knowledge, prompts.

## Quickstart (development)

Requirements: Node 22+, Docker.

```bash
cp .env.example .env            # then set LOOMAI_SECRET (openssl rand -base64 32)
docker compose up -d db         # Postgres 17 + pgvector
npm install
npm run db:migrate
npm run db:seed                 # admin@loomai.local / loomai-admin + demo org
npm run dev
```

Sign in at http://localhost:3000 as `admin@loomai.local` / `loomai-admin` (override with `LOOMAI_ADMIN_PASSWORD` before seeding).

### Connect LM Studio

1. In LM Studio, start the local server (`lms server start`, default port 1234) and load a chat model plus an embedding model.
2. In LoomAI: **Platform admin → AI providers → Auto-discover LM Studio** (or add it manually).
3. Click **Sync models**, then enable the models you want.
4. Open a department and chat — or hire an AI employee that uses the model.

Any OpenAI-compatible server works the same way: add a provider with its base URL (e.g. `https://api.openai.com/v1` plus API key) and sync.

## Production (Docker Compose)

```bash
LOOMAI_SECRET=$(openssl rand -base64 32) docker compose up -d --build
```

The app container runs migrations on boot and serves on port 3000. `host.docker.internal` is mapped so a LM Studio/Ollama instance on the host machine is reachable from inside the container.

## Architecture

```
src/lib/ai         provider plugins (lmstudio, ollama, anthropic, openai-compatible) + registry
src/lib/agents     AI-employee resolution (persona+model+knowledge → chat config), org chart, validation
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

- Delegation engine: coordinator agents decomposing tasks across their reports (`agent_tasks` schema already in place)
- Tool registry & execution (web search, SQL, REST, GitHub…) per workspace
- LDAP / OIDC auth backends
- Web-page ingestion, OCR plugin
- Usage analytics per model/org
