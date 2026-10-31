import { and, eq, lt, notInArray, sql } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import { jobSnapshots, jobSources, jobs } from '../../db/schema.js';
import { canonicalizeUrl, cleanUntrustedText, normalizeText, sha256 } from '../../lib/text.js';
import { certById, knownCertifications } from './certs.js';
import { detectSeniority, heuristicParseJob } from '../../ai/heuristics.js';

export interface JobInput {
  externalId: string;
  title: string;
  company: string;
  description: string;
  location: string | null;
  country?: string | null;
  market?: string | null;
  workMode?: 'remote' | 'hybrid' | 'onsite' | null;
  url: string | null;
  originSite?: string | null;
  postedAt?: string | null;
  certifications?: { id: string; requirement: 'required' | 'preferred' | 'mentioned' }[];
  raw?: unknown;
}

export interface IngestStats { received: number; inBatchDuplicates: number; inserted: number; updated: number; unchanged: number; crossSourceDuplicates: number; closed: number; errors: string[] }

type SourceRow = typeof jobSources.$inferSelect;

/** Cross-source duplicate key: same company + title + location is the same posting. */
export function dedupKeyFor(input: Pick<JobInput, 'company' | 'title' | 'location' | 'market'>, ownerUserId?: number | null): string {
  const base = [input.company, input.title, input.location ?? input.market ?? ''].map((s) => normalizeText(s ?? '')).join('|');
  return sha256(ownerUserId ? `user:${ownerUserId}|${base}` : base);
}

export function contentHashFor(input: Pick<JobInput, 'title' | 'description' | 'certifications'>) {
  return sha256(`${input.title}\n${input.description}\n${JSON.stringify(input.certifications ?? [])}`);
}

/** Parse the JD (AI or heuristic) and merge certification-derived skill signals. */
async function analyze(ctx: AppContext, input: JobInput, useAi: boolean) {
  const tax = await ctx.taxonomy();
  const certs = knownCertifications();
  const role = tax.normalizeRole(input.title);
  let parsed = {
    requiredSkills: [] as string[], preferredSkills: [] as string[], unknownRequirements: [] as string[], qualifications: [] as string[],
    certifications: [] as string[], seniority: null as string | null, workMode: null as string | null, minYears: null as number | null,
    salary: null as { min: number | null; max: number | null; currency: string } | null, parsedBy: 'none',
  };
  if (input.description.trim()) {
    const res = useAi
      ? await ctx.ai.parseJobDescription(input.description, tax, certs)
      : { data: heuristicParseJob(input.description, tax, certs), meta: { mode: 'heuristic' as const, provider: 'heuristic', model: null } };
    parsed = { ...res.data, parsedBy: res.meta.mode === 'ai' ? `ai:${res.meta.provider}` : 'heuristic' };
  }
  const certReqs = [...(input.certifications ?? []), ...parsed.certifications.filter((id) => !(input.certifications ?? []).some((c) => c.id === id)).map((id) => ({ id, requirement: 'mentioned' as const }))];
  for (const c of certReqs) {
    const skillsFromCert = certById(c.id)?.skills ?? [];
    for (const s of skillsFromCert) {
      if (c.requirement === 'required') { if (!parsed.requiredSkills.includes(s)) parsed.requiredSkills.push(s); }
      else if (!parsed.requiredSkills.includes(s) && !parsed.preferredSkills.includes(s)) parsed.preferredSkills.push(s);
    }
  }
  return {
    normalizedRoleId: role.roleId,
    requiredSkills: parsed.requiredSkills,
    preferredSkills: parsed.preferredSkills.filter((s) => !parsed.requiredSkills.includes(s)),
    unknownRequirements: parsed.unknownRequirements,
    qualifications: parsed.qualifications,
    certifications: certReqs.map((c) => ({ id: c.id, name: certById(c.id)?.name, requirement: c.requirement })),
    seniority: detectSeniority(input.title) ?? parsed.seniority,
    workMode: input.workMode ?? (parsed.workMode as JobInput['workMode']) ?? null,
    minYears: parsed.minYears,
    salaryMin: parsed.salary?.min ?? null,
    salaryMax: parsed.salary?.max ?? null,
    salaryCurrency: parsed.salary?.currency ?? null,
    parsedBy: parsed.parsedBy,
  };
}

export async function ingestJobs(
  ctx: AppContext,
  source: SourceRow,
  inputs: JobInput[],
  opts: { markMissing: boolean; ownerUserId?: number | null; useAi?: boolean },
): Promise<IngestStats & { jobIds: number[] }> {
  const { db } = ctx;
  const now = ctx.now();
  const stats: IngestStats & { jobIds: number[] } = { received: inputs.length, inBatchDuplicates: 0, inserted: 0, updated: 0, unchanged: 0, crossSourceDuplicates: 0, closed: 0, errors: [], jobIds: [] };
  const seenIds: number[] = [];

  // Merge duplicates inside one batch first (same posting listed twice by a source),
  // so repeated syncs are stable instead of alternating between variants.
  const merged = new Map<string, JobInput>();
  for (const raw of inputs) {
    const key = dedupKeyFor({ ...raw, title: cleanUntrustedText(raw.title, 200), company: cleanUntrustedText(raw.company || 'Unknown company', 200) }, opts.ownerUserId);
    const prev = merged.get(key);
    if (!prev) { merged.set(key, raw); continue; }
    stats.inBatchDuplicates++;
    const certs = [...(prev.certifications ?? [])];
    for (const c of raw.certifications ?? []) if (!certs.some((x) => x.id === c.id)) certs.push(c);
    merged.set(key, { ...prev, certifications: certs.sort((a, b) => a.id.localeCompare(b.id)), description: prev.description || raw.description });
  }

  for (const raw of merged.values()) {
    try {
      const input: JobInput = { ...raw, title: cleanUntrustedText(raw.title, 200), company: cleanUntrustedText(raw.company || 'Unknown company', 200), description: cleanUntrustedText(raw.description ?? '', 30000) };
      if (!input.title) throw new Error('missing title');
      const canonicalUrl = canonicalizeUrl(input.url);
      const dedupKey = dedupKeyFor(input, opts.ownerUserId);
      const contentHash = contentHashFor(input);

      let [existing] = await db.select().from(jobs).where(eq(jobs.dedupKey, dedupKey));
      if (!existing && canonicalUrl && !opts.ownerUserId) [existing] = await db.select().from(jobs).where(and(eq(jobs.canonicalUrl, canonicalUrl), sql`${jobs.ownerUserId} is null`));

      if (existing) {
        seenIds.push(existing.id);
        stats.jobIds.push(existing.id);
        const crossSource = existing.sourceId !== source.id;
        if (crossSource) stats.crossSourceDuplicates++;
        const base = { lastSeenAt: now, lastCheckedAt: now, status: 'active' as const, duplicateCount: crossSource ? existing.duplicateCount + 1 : existing.duplicateCount };
        // A cross-source duplicate only refreshes freshness; it never overwrites the original's content.
        if (!crossSource && existing.contentHash !== contentHash) {
          const analysis = await analyze(ctx, input, !!opts.useAi);
          await db.update(jobs).set({ ...base, ...analysis, title: input.title, description: input.description, contentHash, location: input.location, canonicalUrl }).where(eq(jobs.id, existing.id));
          await db.insert(jobSnapshots).values({ jobId: existing.id, contentHash, title: input.title, description: input.description, raw: input.raw ?? null });
          stats.updated++;
        } else {
          await db.update(jobs).set(base).where(eq(jobs.id, existing.id));
          stats.unchanged++;
        }
        continue;
      }

      const analysis = await analyze(ctx, input, !!opts.useAi);
      const [row] = await db.insert(jobs).values({
        sourceId: source.id, externalId: input.externalId, ownerUserId: opts.ownerUserId ?? null, canonicalUrl, originSite: input.originSite ?? null,
        title: input.title, company: input.company, description: input.description, location: input.location, country: input.country ?? null,
        market: input.market ?? null, postedAt: input.postedAt ?? null, firstSeenAt: now, lastSeenAt: now, lastCheckedAt: now,
        status: 'active', isDemo: source.isDemo, dedupKey, contentHash, ...analysis,
      }).returning({ id: jobs.id });
      await db.insert(jobSnapshots).values({ jobId: row.id, contentHash, title: input.title, description: input.description, raw: input.raw ?? null });
      seenIds.push(row.id);
      stats.jobIds.push(row.id);
      stats.inserted++;
    } catch (e) {
      stats.errors.push(`${raw.externalId}: ${(e as Error).message}`);
    }
  }

  if (opts.markMissing && source.completeListing) {
    const closed = await db.update(jobs).set({ status: 'closed', lastCheckedAt: now })
      .where(and(eq(jobs.sourceId, source.id), eq(jobs.status, 'active'), seenIds.length ? notInArray(jobs.id, seenIds) : sql`true`))
      .returning({ id: jobs.id });
    stats.closed = closed.length;
  }
  return stats;
}

/** Jobs not seen for `days` are no longer known to be open. */
export async function markStaleJobs(ctx: AppContext, days = 45) {
  const cutoff = new Date(ctx.now().getTime() - days * 86_400_000);
  const rows = await ctx.db.update(jobs).set({ status: 'unknown' })
    .where(and(eq(jobs.status, 'active'), eq(jobs.isDemo, false), lt(jobs.lastSeenAt, cutoff)))
    .returning({ id: jobs.id });
  return rows.length;
}
