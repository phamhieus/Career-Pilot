# Architecture

```
apps/
  api/   Fastify + TypeScript + Drizzle ORM (PostgreSQL / PGlite)
    src/ai/         one AI service: OpenAI-compatible client, schemas, heuristics
    src/services/   deterministic engines (matching, planning, verification, interviews, CV, market, jobs)
    src/routes/     HTTP layer (Zod-validated input, user-scoped authorization)
    src/seed/data/  curated catalog: skills, roles, transitions, roadmaps, resources, assessment items, demo jobs
    drizzle/        SQL migrations
    test/           engine unit tests + end-to-end acceptance test
  web/   React 19 + Vite + Tailwind v4 + React Router + TanStack Query + React Flow + Recharts + RHF/Zod
```

**Principle: AI handles language; the backend owns numbers and rules.** The AI parses JDs and CVs, writes interview questions, grades open answers against rubrics, and rewrites text. Scores, verification status, plan schedules, state transitions and permissions are computed deterministically in `services/`, and every AI output is validated before it is used.

## Data model

One coherent model connects all modules.

| Area | Tables |
|---|---|
| Identity and profile | `users`, `sessions`, `career_profiles`, `profile_items` (work/project/education/certification, `confirmed` flag) |
| Catalog | `career_families`, `career_roles`, `skills` (with prerequisite DAG), `role_skill_requirements` (weighted matrix, `critical`), `career_transitions` |
| Roadmaps | `roadmaps`, `roadmap_nodes` (skill/concept/project/assessment, group, layout x/y), `roadmap_edges`, `learning_resources` |
| Evidence | `user_skills` (derived status), `skill_evidence` (append-only trail: type, score, observed level, grading method, source reference) |
| Assessments | `assessment_items`, `assessment_blueprints`, `assessment_attempts`, `evaluations` |
| Interviews | `interview_sessions` (blueprint, state, difficulty), `interview_messages` (rubric, hidden ideal points, evaluation), `interview_reports` |
| Learning | `learning_plans`, `milestones`, `learning_tasks`, `plan_revisions` |
| Jobs and market | `job_sources`, `jobs` (normalized role, provenance, freshness, `dedup_key`, `is_demo`, `owner_user_id` for private imports), `job_snapshots`, `market_observations` |
| CVs | `resumes`, `resume_versions` (sections and bullets as validated JSON, quality report), `resume_evidence` (bullet → source links) |
| Applications | `job_applications` (stage, separate outcome, job snapshot, exact `resume_version_id`), `application_events`, `interview_rounds` (linked to practice sessions) |
| Operations | `ai_request_logs` (metadata only, never content) |

## Skill evidence and verification

Statuses: **Self-reported**, **Extracted claim** (CV or history), **Assessed**, and **App-verified**. A skill with no evidence at all is *Unknown*.

`services/evidence.ts › deriveStatus` re-derives a skill's status from its evidence trail on every write:

- **App-verified** requires, within 365 days, a latest *objective quiz* ≥ 70% **and** a latest *scenario/practical/case/project* task ≥ 70%, graded objectively or by AI rubric.
- **Assessed** means some assessment, practical or interview evidence exists, but verification is not met. Interview observations and heuristic-graded answers can never verify a skill.
- **Course completion** is recorded but never raises status above self-reported.

## Role matching (four independent dimensions)

`services/matching.ts` produces separate scores. They are never merged into one number.

- **Capability.** Each requirement earns `credit = min(1, level / required) × trust`, with trust 1.0 for verified, 0.85 assessed, 0.6 self-reported and 0.5 for a claim (assumed level 2.5). Missing evidence is **UNKNOWN** and is excluded from the score, but reported as coverage. Weights are normalized. Relevant experience contributes 20% when known.
- **Critical gate.** A critical requirement can be *met*, *claimed*, *gap* or *unknown*. Any gap blocks the role regardless of the other scores.
- **Interest.** Task affinity (60%), work values (25%) and family interest (15%), counting only the parts the user has provided.
- **Growth.** Transferable coverage, gap hours vs weekly hours and deadline, prerequisite depth, and recent plan follow-through.
- **Market.** Real (non-demo) postings mapped to the role in the last 120 days, relative to the most-posted role, plus location fit. With fewer than 5 postings the result is "Insufficient market data".

## Job matching

`services/jobMatching.ts`: required skills weigh 2 and preferred skills 1, with levels taken from the role matrix and shifted by seniority. The score combines skills (60%), seniority (15%), experience (10%) and location/work mode (15%), with unknown components excluded. The result also lists critical gaps (including required certifications), unknown requirements, assessments from the item bank, roadmap nodes for the gaps, and checks to do manually.

## Learning plan engine

`services/learning.ts › buildPlanSchedule` is a pure function:

1. **Skip:** app-verified skill nodes, completed nodes, and checkpoints whose skills are all verified.
2. **Remaining hours:** base hours × (required/3) × gap fraction, with at least 25% kept for review.
3. **Order:** Kahn topological sort with a priority tie-break: critical skills, then weight, then market share; checkpoints run as soon as they unlock.
4. **Expand tasks:** learn (60%) and practice (40%), plus an assessment task for critical skills without a checkpoint.
5. **Fill weeks** without exceeding weekly hours, splitting large tasks across weeks.
6. **Daily sessions** within the 14-day horizon, split to daily capacity; later work stays weekly.
7. **Milestones** every four weeks, plus a **feasibility** check against the deadline. When it fails, the plan offers concrete options and never produces an overloaded schedule.

`replan` keeps history, rebuilds the future from today, and writes a `plan_revisions` row with added and removed nodes and the change in end date. Revisions are triggered by:

| Trigger | Revision |
|---|---|
| Assessment passed | `assessment_passed` |
| Assessment failed (adds remedial review + retake) | `assessment_failed` |
| Missed sessions | `missed_sessions` |
| New goal (archives the old plan) | `goal_changed` |
| Tracked jobs requiring skills outside the plan | `job_requirements_changed` |

## Interview engine

State machine: `planned → in_progress → completed | abandoned`, enforced by `assertTransition`.

- **Blueprint** (built before the start): topics chosen from the JD's required skills, critical and high-weight role skills, and requested focus areas, plus behavioral, case or system-design topics according to the round type.
- **Adaptation** (`decideNext`, deterministic): a score below 0.6 with a follow-up need gets one follow-up per topic (two in focused mode). Scores ≥ 0.8 raise difficulty; scores below 0.4 lower it. The session completes when topics, the question budget or the time runs out.
- **Answer privacy:** rubrics, hidden ideal points and evaluations stay server-side until completion. Focused mode is the only exception, showing per-answer feedback without model answers.
- **Report:** a weighted score (follow-ups ×0.5), rubric aggregation, quotes (validated as exact substrings of the answer), improvements, learning tasks, and a comparison with the last session of the same mode, round and role. Skill topics become `interview_observation` evidence.

## CV builder

- **Master CV:** built only from **confirmed** profile items and evidenced skills.
- **Tailored CV:** ranks bullets by JD relevance, then has the AI rewrite them. `validateAgainstSource` flags any number or skill in the new text that is missing from the bullet's source evidence, and the bullet becomes `needs_confirmation` until the user reverts, edits, links evidence or confirms it.
- **Versioning:** every save creates a new `resume_version`, re-validated and with normalized `resume_evidence` rows. Locked sections and bullets survive regeneration.
- **Quality** covers JD relevance, clarity, completeness, format compatibility, evidence coverage and unverified claims, and explicitly makes **no ATS pass promise**.
- **Export:** DOCX via `docx`, PDF via `pdfkit` with bundled Noto Sans (OFL) for Vietnamese.

## AI service

`ai/client.ts` is one OpenAI-compatible Chat Completions client, so OpenAI and DeepSeek are a configuration choice. It provides:

- `response_format: json_object`
- per-call timeouts, plus exponential-backoff retries on 429/5xx/timeouts
- a correction round when the output fails its Zod schema
- request logging of metadata only

`ai/service.ts` exposes the workflows: `parseJobDescription`, `parseResume`, `interviewQuestion`, `evaluateAnswer`/`gradeOpenAnswer`, `extractDiscovery`, `rewriteBullets`, `writeSummary` and `generateMcqs`. Each one:

- wraps untrusted text in `<untrusted_document>` delimiters, strips spoofed delimiters, and tells the model never to follow embedded instructions;
- validates output against a schema;
- **post-validates against the source:**
  - JD salary only when the numbers appear verbatim in the text;
  - CV entries must appear in the original document;
  - interview quotes must be exact substrings of the answer;
  - discovery fields are restricted to allowed enums, and protected characteristics are explicitly excluded;
  - interview scores are recomputed deterministically from the criterion scores;
- returns `meta.mode = 'ai' | 'heuristic'` with a `fallbackReason`, so mock or heuristic data is never silently substituted.

## Guided onboarding

`services/onboarding.ts` defines 15 steps that mirror the acceptance scenario.

- **Completion comes from real records:** confirmed experience, completed interviews, plans, graded attempts, user-edited tailored CV versions, and applications.
- **Seen markers:** pages the server can observe (role, matching, roadmap, job detail, CV export, application detail) record a marker in `career_profiles.onboarding` when opened. The Skills tab marks itself through `POST /api/onboarding/seen`, which accepts only allow-listed keys.
- **In the web app:** the full guide lives at `/welcome`, with a progress ring in the sidebar and a sticky guide bar on every page. The bar polls while the user works, explains what to do on the current page, and announces when a step completes.

## Per-user AI settings

- **Storage:** `user_ai_settings` holds provider, model, base URL and an **AES-256-GCM encrypted** key (`lib/secrets.ts`, keyed by `APP_SECRET`). Only a `••••1234` hint is ever returned.
- **Resolution:** every route builds a request-scoped context (`userContext`) whose `ai` uses the user's settings, or the server default if none are saved. All AI workflows therefore follow the user's choice automatically.
- **SSRF protection:** custom base URLs must be public HTTPS hosts.

## AI coaching and suggestions

- **Interview coaching** (`coachInterview`) runs after completion, using the transcript and rubric notes. It returns a summary, improvements, per-question tips and next focus areas. Tips must reference real question numbers, and the score is never changed.
- **Suggestions** (`suggestNextSteps`) turn deterministic facts (stage, rounds, gaps, plan progress, onboarding) into 2–4 next steps.
  - Links are kept only if they appear in a server-provided allow-list.
  - The model is told never to apply or contact anyone on the user's behalf.
  - Results are cached for 10 minutes.
  - When no AI is configured or the call fails, the rule-based list is shown and labeled as such.

## Security and privacy

- **Sessions:** cookies are httpOnly and SameSite=Lax, and only the token's SHA-256 is stored. Passwords use scrypt. A same-origin check guards every mutating request.
- **Authorization:** every private resource is scoped by `user_id`, so another user's IDs return 404. Private JD imports carry `owner_user_id` and stay invisible to others.
- **Input handling:** all request input is validated with Zod. Uploads are limited to 5 MB and checked by magic bytes (`%PDF`, `PK`); untrusted HTML and text are cleaned.
- **Your data:** `/api/me/export` exports everything as JSON, and `DELETE /api/me` cascades deletion through all personal data. Audio is never uploaded: voice answers are dictated in the browser (Web Speech API, or OS-level tools such as Wispr Flow typing into the field), and only text is stored.

## Testing

`npm test` runs 30 tests:

- **Engines:** weight normalization, UNKNOWN handling, critical gates, verification policy, DAG validation, topological ordering, scheduler capacity and daily sessions, dedup keys, JD parsing, interview transitions and adaptation, quote validation, stage rules, forecast gating.
- **End-to-end:** the full acceptance scenario with a mocked AI provider, authorization isolation, CSRF, account deletion, heuristic grading never verifying, remedial and missed-session replanning, goal change, CV versioning and restore, and AI-failure fallback.

## Known limitations and next priorities

**Assessments**
- Practical items are rubric-graded text answers. Sandboxed code execution with unit tests is not implemented.
- Heuristic grading (when no AI key is set) is keyword-based and deliberately cannot verify skills.

**Job market data**
- Cert Trends publishes no JD text, so those jobs carry only certification-derived skill signals. Users can paste the JD to analyze a private copy.
- Historical data covers mostly two dense months (Sep–Oct 2026), so forecasts correctly report "Insufficient historical data".
- Greenhouse and Lever adapters are implemented against their documented public APIs but are disabled until board tokens are configured. No other sources, and no search-based discovery, are integrated.

**Voice and interviews**
- Voice is dictation-to-text. Text-to-speech and real-time duplex audio are not implemented.

**Catalog**
- 8 roadmaps are curated; the remaining 31 are auto-generated from skill matrices and labeled as such.
- Role outlook text is qualitative and cites sources without quoting statistics. Live market numbers come only from ingested data.

**Planned next (P1)**
- More curated roadmaps and item-bank depth.
- Code-execution assessments.
- Notifications, calendar and email integration (manual by design today).
- Additional permitted job APIs.
- Richer analytics, and TTS for interviews.
