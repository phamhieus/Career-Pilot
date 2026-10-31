# Job-provider integration guide

CareerPilot ingests postings only from **permitted** sources: published datasets, documented public job-board APIs, and text the user pastes. It never bypasses anti-bot measures, never scrapes sites that disallow it, and does not claim access to any unrestricted Google Jobs API.

## Built-in sources

| Key | Type | What it reads | Complete listing? |
|---|---|---|---|
| `cert-trends` | `cert_trends` | `${CERT_TRENDS_BASE_URL}/jobs.json` (postings with source name/URL, certifications) and `/roles.json` (monthly role aggregates → `market_observations`) | No: absent jobs are *not* closed |
| `greenhouse:<token>` | `greenhouse` | `https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true` | Yes: missing jobs are marked `closed` |
| `lever:<company>` | `lever` | `https://api.lever.co/v0/postings/<company>?mode=json` | Yes |
| `manual` | `manual` | JD text pasted by a user (stored privately with `owner_user_id`) | n/a |
| `demo` | `demo` | Fictional postings from `seed/data/demo-jobs.ts` (`is_demo = true`) | n/a |

To enable company boards, list them in `apps/api/.env` and restart, which registers the sources:

```env
GREENHOUSE_BOARDS=examplecompany,anotherco
LEVER_COMPANIES=examplestartup
```

Sync manually (Jobs → Sources → *Sync now*, or `POST /api/jobs/sources/:key/sync`) or on a schedule with `JOB_SYNC_INTERVAL_MINUTES`.

If the live Cert Trends endpoint is unreachable, a bundled snapshot (2026-10-31) can be imported **explicitly** with `{"useSnapshot": true}`. The source is then marked `snapshot`, and the sync message says so.

## About the Cert Trends source

Cert Trends ([github.com/phamhieus/cert-chart](https://github.com/phamhieus/cert-chart)) crawls these boards:

- ITviec, Vieclam24h, TopCV, CareerViet (Vietnam)
- MyCareersFuture (Singapore), TokyoDev (Japan)
- Greenhouse, Arbeitnow, Himalayas, Remote OK, Remotive, We Work Remotely
- LinkedIn, via Brave Search results only

The crawler honours `robots.txt`, sends a descriptive user-agent and rate-limits its requests. GitHub Actions refreshes `public/data` twice a day. CareerPilot relies on these facts about it:

- **`jobs.json` is a filtered sample.** A posting is kept only if it names a tracked certification. CareerPilot labels it accordingly in matching and the market view.
- **`roles.json` is the unbiased role-demand signal.** Titles are counted over *every* posting on boards whose full listing is enumerated, with `scanned` as the denominator. Role ids are `qa`, `ba` and `devops`; the `devops` bucket also covers SRE and platform titles, so it maps to all three of those CareerPilot roles.
- **There is no JD text today.** The crawler extracts the JSON-LD `description` but does not publish it. The provider already reads `description` if a future export includes it.

## Pipeline

```
provider.fetch() ──► JobInput[] ──► ingestJobs()
                                  ├─ merge in-batch duplicates (union of certifications)
                                  ├─ clean untrusted text (HTML/control chars, length caps)
                                  ├─ dedupKey = sha256(normalized company | title | location)
                                  │    (private imports are namespaced per user)
                                  ├─ match an existing job by dedupKey or canonical URL
                                  │    same source + changed content → re-parse + new job_snapshot
                                  │    other source               → refresh last_seen, duplicate_count++
                                  ├─ new job → JD parsing (heuristic for bulk syncs, AI for manual imports)
                                  │    + certification → skill signals + role normalization
                                  └─ complete listings: jobs not seen this sync → status 'closed'
markStaleJobs(): active jobs not seen for 45 days → status 'unknown'
```

Each job keeps `canonical_url`, `origin_site`, `posted_at`, `first_seen_at`, `last_seen_at`, `last_checked_at`, `status` and its snapshots. The UI shows all of them as provenance.

## Adding a provider

1. Implement `JobProvider` in `apps/api/src/services/jobs/providers.ts`:

   ```ts
   export const myProvider: JobProvider = {
     type: 'my_type',
     async fetch(ctx, source) {
       const data = await getJson<MyShape>(ctx, source.baseUrl!);
       return { jobs: data.items.map((x) => ({ externalId: x.id, title: x.title, company: x.company, description: x.html ?? '', location: x.location, url: x.url, originSite: 'My Board', postedAt: x.date })) };
     },
   };
   ```

2. Register it in `PROVIDERS`, add the source type to the `job_sources.type` union, and register the source row in `seedDatabase`, as is done for Greenhouse.
3. Set `completeListing: true` only if the API returns **all** open jobs, so that absence reliably means closed.
4. Add a fixture-backed test (see the Cert Trends sync in `test/e2e.test.ts`). Tests inject `fetch`, so they never hit the network.

Before adding any source, confirm its terms of service permit automated access, respect rate limits, and identify the client in the User-Agent.
