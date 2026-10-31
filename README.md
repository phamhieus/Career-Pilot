# CareerPilot AI

An AI-assisted career intelligence and growth platform for technology careers. Career discovery, skill evidence, role and job matching, learning plans, mock interviews, CV building and application tracking share **one data model**, so every module builds on the same records.

> Design follows `DESIGN.md` (warm paper canvas, hairline white cards, a single blue primary action, accent cards), with a warm dark mode.

## Quick start

Requirements: **Node.js ≥ 20** (tested on 24). PostgreSQL 14+ is optional for development.

```bash
npm install
cp apps/api/.env.example apps/api/.env   # optional — edit AI and database settings
npm run dev                               # API on :4000, web on :5173 (Vite proxies /api)
```

Open http://localhost:5173 and create an account. New accounts land on **Getting started** (`/welcome`), a 15-step guide in five phases: profile → explore roles → pick a job → learn & verify → apply. A guide bar on every page shows the current step and what to do on that page, and moves on automatically when the step is done. To try everything quickly, choose *Load sample profile* on the welcome page.

**AI provider:** open **Settings → AI provider**, pick OpenAI (ChatGPT), DeepSeek or another OpenAI-compatible API, paste your key and click *Test connection*. Keys are encrypted at rest (AES-256-GCM with `APP_SECRET`) and never sent back to the browser. Each user can use their own key; otherwise the server default from `.env` applies.

With no `DATABASE_URL`, the API uses **PGlite** (the PostgreSQL engine compiled to WASM) stored in `apps/api/.data/pglite`. It runs the same SQL migrations as production Postgres. To use a real PostgreSQL server:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/careerpilot npm run dev:api
```

Migrations run automatically on start, and seeding is idempotent. They can also be run explicitly with `npm run db:migrate` and `npm run db:seed`.

## Environment variables (`apps/api/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API port |
| `DATABASE_URL` | – | PostgreSQL connection string. Unset = PGlite (dev only) |
| `PGLITE_DATA_DIR` | `.data/pglite` | PGlite storage directory |
| `AI_PROVIDER` | `none` | `openai`, `deepseek`, `openai-compatible` or `none` |
| `AI_API_KEY` | – | Server-side key. Never sent to the browser |
| `AI_BASE_URL` | per provider | `https://api.openai.com/v1` or `https://api.deepseek.com/v1` |
| `AI_MODEL` | per provider | `gpt-4.1-mini` (OpenAI), `deepseek-chat` (DeepSeek) |
| `AI_TIMEOUT_MS` / `AI_MAX_RETRIES` | `30000` / `2` | Per-call timeout and retries |
| `CERT_TRENDS_BASE_URL` | `https://cert-chart.vercel.app/data` | Cert Trends static data endpoint |
| `GREENHOUSE_BOARDS` / `LEVER_COMPANIES` | – | Comma-separated public job-board tokens or company slugs |
| `JOB_SYNC_INTERVAL_MINUTES` | `0` | Background sync interval (0 = manual "Sync now" only) |
| `APP_ORIGIN` | – | Extra allowed origins for state-changing requests |
| `APP_SECRET` | dev: generated in `.data/app-secret` | Encrypts API keys saved in Settings. **Required in production** |

**Without an AI key**, every AI workflow falls back to a deterministic heuristic, and the UI labels each result "Heuristic mode". Heuristic grades never verify a skill.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API + web in watch mode |
| `npm test` | API unit and end-to-end tests (Vitest, real Postgres engine via PGlite) |
| `npm run typecheck` | Type-check API and web |
| `npm run build` | Compile the API to `apps/api/dist` and build the web app to `apps/web/dist` |
| `npm start` | Run the compiled API. With `NODE_ENV=production` it also serves `apps/web/dist` |
| `npm run demo:rehearse` | Check the fresh-account demo flow quickly, without recording |
| `npm run demo:record` | Record the fresh-account demo and export a verified 180-second MP4 (Chrome, Playwright FFmpeg, system ffmpeg/ffprobe required; see [demo guide](docs/DEMO.md)) |

## Modules and routes

| Module | Route(s) | Highlights |
|---|---|---|
| Getting started | `/welcome` | Guided 15-step journey matching the end-to-end scenario; progress derived from real records; contextual guide bar on every page |
| Dashboard | `/dashboard` | Next getting-started step, profile completeness, target-role indicators, this week's sessions, AI-suggested next steps |
| A · Tech Career Atlas | `/atlas`, `/atlas/:roleSlug` | 39 roles in 11 families; responsibilities, levels, skill matrix, collaboration, transitions; outlook split into **observed / attributed prediction / editorial speculation**, with sources |
| B · Career Map + Skill Roadmap | `/career-map`, `/roadmap/:roleSlug` | Two separate React Flow graphs; roadmap has pan/zoom/minimap, collapsible groups, statuses, prerequisite chain highlight, gap ring, node drawer with resources and assessments |
| C · Career Profile | `/profile` | Manual entries, CV import (PDF/DOCX/TXT → *unconfirmed* entries), skills by evidence status, interests/values/task affinity, constraints |
| D · Role Matching | `/matching` | Capability, Interest, Growth, Market as independent dimensions with coverage and confidence; critical-skill gate; UNKNOWN ≠ 0 |
| E · Job Intelligence | `/jobs`, `/jobs/:id` | Cert Trends sync, Greenhouse/Lever adapters, manual JD import, labeled demo jobs; dedup, snapshots, freshness, provenance |
| F · Job Matching | `/jobs/:id` | Deterministic score with explanation, evidence coverage, matched skills, critical gaps, unknowns, recommended assessments, roadmap nodes, link to the original posting |
| G · Market | `/market` | Historical observations, current signals and forecast scenarios kept separate; OLS trend with interval only when ≥ 6 consecutive months exist; otherwise "Insufficient historical data" |
| H · Assessments | `/assessments`, `/assessments/attempts/:id` | Blueprints from role/level/gaps; objective MCQ grading; rubric grading for scenario/practical/case items; evidence persisted; plan adapts |
| I · Mock Interviews | `/interviews`, `/interviews/new`, `/interviews/:id` | AI interviewer with four modes and six round types; blueprint first; one question at a time; adaptive follow-ups and difficulty; no model answers until completion; report with quotes, comparison and **AI coaching** (summary, per-question tips), which never changes the score |
| J · Learning Plan | `/learning`, `/learning/:planId` | Priority-aware topological schedule; weekly capacity respected; deadline feasibility; milestones; daily sessions for 14 days only; revisions on pass/fail/missed/goal/job changes |
| K · CV Builder | `/resume`, `/resume/:id` | Master and tailored CVs from confirmed evidence; each bullet linked to its source; unsupported rewrites flagged; locks, versions, restore; EN/VI; DOCX and PDF export |
| L · Applications | `/applications`, `/applications/:id` | Kanban, table, analytics; stages plus separate outcomes; exact CV version; rounds linked to practice sessions; timeline; rule-based next actions plus **AI-recommended next actions** grounded in those facts |
| Settings | `/settings` | AI provider and API key (per user, encrypted), theme, data export, account deletion |

## Acceptance scenario (tested)

`apps/api/test/e2e.test.ts` drives the full scenario through the HTTP API on a real Postgres engine, with a mocked OpenAI-compatible provider. A backend developer:

1. imports a profile and runs a discovery interview, then applies the suggestions;
2. explores the AI Engineer and Cloud Engineer roles and sees four-dimension matching with evidence gaps;
3. views the interactive roadmap;
4. syncs real Cert Trends postings (and re-syncs without duplicates), opens a labeled demo job, and imports a JD;
5. sees job matching with critical gaps;
6. generates a learning plan, completes a practice task and passes an assessment, after which the skill becomes *App-verified* and the plan revises;
7. runs a job-specific mock interview;
8. generates and edits a tailored CV, where a fabricated "40%" from the AI is flagged;
9. exports the CV as PDF and DOCX;
10. saves the job to the tracker with that exact CV version and progresses the application, receiving next actions.

The same flow was also exercised in a real browser (Chrome via Playwright) with no console errors.

## Demo data policy

- **Demo jobs** use fictional companies marked "(Demo)", have no salary, carry `is_demo = true`, and always show a *Demo* badge. They are excluded from market statistics unless explicitly included.
- **Cert Trends data** is real, collected by the [cert-chart](https://github.com/phamhieus/cert-chart) crawler (robots.txt-compliant, rate-limited). Its `jobs.json` contains only postings that **name a certification**, so CareerPilot labels it as a filtered sample and uses `roles.json` (counted over every posting on fully-enumerated boards) for role demand. A snapshot from 2026-10-31 is bundled in `apps/api/fixtures/cert-trends/` for tests and as an explicit, labeled offline import. Live sync fetches the configured URL.
- The **sample profile** is labeled "(sample)" in every entry.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system design, data model, scoring and verification rules, AI safety
- [docs/JOB_PROVIDERS.md](docs/JOB_PROVIDERS.md): job-source integration guide
- [Known limitations and next priorities](docs/ARCHITECTURE.md#known-limitations-and-next-priorities)
