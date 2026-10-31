import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import { jobSources, marketObservations } from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { FIXTURE_DIR } from './certs.js';
import { ingestJobs, markStaleJobs, type IngestStats, type JobInput } from './ingest.js';

export interface ProviderResult { jobs: JobInput[]; observations?: (typeof marketObservations.$inferInsert)[]; note?: string }

/** A job provider fetches postings from one permitted source. No scraping of restricted sites. */
export interface JobProvider {
  type: string;
  fetch(ctx: AppContext, source: typeof jobSources.$inferSelect, opts: { useSnapshot?: boolean }): Promise<ProviderResult>;
}

async function getJson<T>(ctx: AppContext, url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await ctx.fetch(url, { headers: { accept: 'application/json', 'user-agent': 'CareerPilot/0.1 (+job-intelligence; respectful polling)' }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Cert Trends (the user's own project; static JSON published at /data/*.json)
// ---------------------------------------------------------------------------
interface CtJob { id: string; title: string; company: string; description?: string; location?: { country?: string; market?: string; city?: string }; certifications?: { id: string; requirement: 'required' | 'preferred' | 'mentioned' }[]; source?: { name?: string; url?: string }; postedAt?: string; crawledAt?: string }
interface CtRole { roleId: string; source?: { name?: string }; market: string; month: string; postings: number; withCertification: number; scanned: number; crawledAt: string }

export const certTrendsProvider: JobProvider = {
  type: 'cert_trends',
  async fetch(ctx, source, opts) {
    let jobsData: CtJob[];
    let rolesData: CtRole[];
    let note: string | undefined;
    if (opts.useSnapshot) {
      jobsData = JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'jobs.json'), 'utf8'));
      rolesData = JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'roles.json'), 'utf8'));
      note = 'Imported from the bundled Cert Trends snapshot (downloaded 2026-10-31), not a live fetch.';
    } else {
      const base = (source.baseUrl ?? ctx.config.jobs.certTrendsBaseUrl).replace(/\/$/, '');
      [jobsData, rolesData] = await Promise.all([getJson<CtJob[]>(ctx, `${base}/jobs.json`), getJson<CtRole[]>(ctx, `${base}/roles.json`)]);
    }
    if (!Array.isArray(jobsData)) throw new Error('Unexpected Cert Trends jobs.json format');
    const jobs: JobInput[] = jobsData.filter((j) => j.title && j.company).map((j) => ({
      externalId: j.id,
      title: j.title,
      company: j.company,
      // Cert Trends parses the JSON-LD description while crawling but does not publish it today;
      // if a future export includes it, it is analyzed like any other JD.
      description: typeof j.description === 'string' ? j.description : '',
      location: [j.location?.city, j.location?.country].filter(Boolean).join(', ') || null,
      country: j.location?.country ?? null,
      market: j.location?.market ?? null,
      workMode: j.location?.market === 'remote' ? 'remote' : null,
      url: j.source?.url ?? null,
      originSite: j.source?.name ?? null,
      postedAt: j.postedAt ?? null,
      certifications: j.certifications ?? [],
      raw: j,
    }));
    const observations = (Array.isArray(rolesData) ? rolesData : []).flatMap((r) => (['postings', 'withCertification', 'scanned'] as const).map((metric) => ({
      sourceKey: source.key, origin: r.source?.name ?? 'unknown', period: r.month, roleKey: r.roleId, market: r.market,
      metric: metric === 'withCertification' ? 'with_certification' : metric, value: r[metric] ?? 0, isDemo: false, collectedAt: new Date(r.crawledAt),
    })));
    return { jobs, observations, note };
  },
};

// ---------------------------------------------------------------------------
// Greenhouse Job Board API (public, documented, intended for embedding job boards)
// ---------------------------------------------------------------------------
interface GhJob { id: number; title: string; updated_at?: string; first_published?: string; location?: { name?: string }; absolute_url?: string; content?: string }

export const greenhouseProvider: JobProvider = {
  type: 'greenhouse',
  async fetch(ctx, source) {
    const token = source.key.split(':')[1];
    const [board, list] = await Promise.all([
      getJson<{ name?: string }>(ctx, `https://boards-api.greenhouse.io/v1/boards/${token}`).catch(() => ({ name: token })),
      getJson<{ jobs: GhJob[] }>(ctx, `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`),
    ]);
    return {
      jobs: list.jobs.map((j) => ({
        externalId: String(j.id), title: j.title, company: board.name ?? token, description: j.content ?? '',
        location: j.location?.name ?? null, workMode: /remote/i.test(j.location?.name ?? '') ? 'remote' : null,
        url: j.absolute_url ?? null, originSite: 'Greenhouse', postedAt: (j.first_published ?? j.updated_at ?? '').slice(0, 10) || null, raw: { id: j.id },
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// Lever Postings API (public, documented)
// ---------------------------------------------------------------------------
interface LeverPosting { id: string; text: string; categories?: { location?: string; commitment?: string }; workplaceType?: string; descriptionPlain?: string; lists?: { text: string; content: string }[]; additionalPlain?: string; hostedUrl?: string; createdAt?: number }

export const leverProvider: JobProvider = {
  type: 'lever',
  async fetch(ctx, source) {
    const company = source.key.split(':')[1];
    const postings = await getJson<LeverPosting[]>(ctx, `https://api.lever.co/v0/postings/${company}?mode=json`);
    return {
      jobs: postings.map((p) => ({
        externalId: p.id, title: p.text, company,
        description: [p.descriptionPlain ?? '', ...(p.lists ?? []).map((l) => `${l.text}\n${l.content}`), p.additionalPlain ?? ''].join('\n\n'),
        location: p.categories?.location ?? null,
        workMode: (['remote', 'hybrid', 'onsite'] as const).find((m) => m === p.workplaceType?.replace('on-site', 'onsite')) ?? null,
        url: p.hostedUrl ?? null, originSite: 'Lever', postedAt: p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : null, raw: { id: p.id },
      })),
    };
  },
};

const PROVIDERS: Record<string, JobProvider> = { cert_trends: certTrendsProvider, greenhouse: greenhouseProvider, lever: leverProvider };

export async function syncSource(ctx: AppContext, key: string, opts: { useSnapshot?: boolean } = {}): Promise<IngestStats & { note?: string; observations: number }> {
  const [source] = await ctx.db.select().from(jobSources).where(eq(jobSources.key, key));
  if (!source) throw notFound('Job source');
  const provider = PROVIDERS[source.type];
  if (!provider) throw badRequest(`Source type "${source.type}" is not synchronizable`);
  try {
    const result = await provider.fetch(ctx, source, opts);
    // Large automated imports use the deterministic parser (bounded cost); manual imports use AI.
    const stats = await ingestJobs(ctx, source, result.jobs, { markMissing: !opts.useSnapshot, useAi: false });
    let observations = 0;
    for (const o of result.observations ?? []) {
      await ctx.db.insert(marketObservations).values(o).onConflictDoUpdate({
        target: [marketObservations.sourceKey, marketObservations.origin, marketObservations.period, marketObservations.roleKey, marketObservations.market, marketObservations.metric],
        set: { value: o.value, collectedAt: o.collectedAt },
      });
      observations++;
    }
    await markStaleJobs(ctx);
    const message = `${stats.inserted} new,${stats.inBatchDuplicates ? ` ${stats.inBatchDuplicates} duplicate listings merged,` : ''} ${stats.updated} updated, ${stats.unchanged} unchanged, ${stats.crossSourceDuplicates} cross-source duplicates, ${stats.closed} closed${stats.errors.length ? `, ${stats.errors.length} errors` : ''}${result.note ? `. ${result.note}` : ''}`;
    await ctx.db.update(jobSources).set({ lastSyncAt: ctx.now(), lastSyncStatus: opts.useSnapshot ? 'snapshot' : 'ok', lastSyncMessage: message }).where(eq(jobSources.id, source.id));
    return { ...stats, note: result.note, observations };
  } catch (e) {
    await ctx.db.update(jobSources).set({ lastSyncAt: ctx.now(), lastSyncStatus: 'error', lastSyncMessage: (e as Error).message.slice(0, 300) }).where(eq(jobSources.id, source.id));
    throw badRequest(`Sync failed for ${source.name}: ${(e as Error).message}`);
  }
}

/** Background scheduler for enabled, synchronizable sources (opt-in via JOB_SYNC_INTERVAL_MINUTES). */
export function startJobSyncScheduler(ctx: AppContext, log: (msg: string) => void): () => void {
  const minutes = ctx.config.jobs.syncIntervalMinutes;
  if (!minutes) return () => {};
  const tick = async () => {
    const sources = await ctx.db.select().from(jobSources).where(eq(jobSources.enabled, true));
    for (const s of sources.filter((x) => PROVIDERS[x.type])) {
      try {
        const r = await syncSource(ctx, s.key);
        log(`job sync ${s.key}: ${r.inserted} new / ${r.updated} updated`);
      } catch (e) {
        log(`job sync ${s.key} failed: ${(e as Error).message}`);
      }
    }
  };
  const handle = setInterval(() => void tick(), minutes * 60_000);
  return () => clearInterval(handle);
}
