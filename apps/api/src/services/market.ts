import { and, eq, isNull } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { careerRoles, jobSources, jobs, marketObservations, skills } from '../db/schema.js';
import { monthKey } from '../lib/dates.js';
import { round } from '../lib/text.js';
import { certById } from './jobs/certs.js';

export interface ForecastResult {
  status: 'ok' | 'insufficient';
  reason: string;
  method?: string;
  points?: { period: string; value: number; low: number; high: number }[];
}

/** Ordinary least squares on a monthly series with an ~80% prediction interval. Pure; exported for tests. */
export function linearForecast(series: { period: string; value: number }[], horizon = 3, minPoints = 6): ForecastResult {
  const pts = series.filter((s) => Number.isFinite(s.value)).sort((a, b) => a.period.localeCompare(b.period));
  if (pts.length < minPoints) return { status: 'insufficient', reason: `Insufficient historical data: ${pts.length} month(s) available, at least ${minPoints} consecutive months are required for a statistical trend.` };
  // Require consecutive months
  const idx = (p: string) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1;
  for (let i = 1; i < pts.length; i++) if (idx(pts[i].period) - idx(pts[i - 1].period) !== 1) return { status: 'insufficient', reason: 'Insufficient historical data: the monthly series has gaps.' };
  const n = pts.length;
  const xs = pts.map((_, i) => i);
  const ys = pts.map((p) => p.value);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / sxx;
  const intercept = my - slope * mx;
  const resid = ys.map((y, i) => y - (intercept + slope * xs[i]));
  const se = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / Math.max(1, n - 2));
  const z = 1.2816; // ~80% two-sided
  const last = pts.at(-1)!.period;
  const points = Array.from({ length: horizon }, (_, h) => {
    const x = n + h;
    const yhat = intercept + slope * x;
    const pi = z * se * Math.sqrt(1 + 1 / n + (x - mx) ** 2 / sxx);
    const m = idx(last) + h + 1;
    return { period: `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`, value: round(Math.max(0, yhat), 1), low: round(Math.max(0, yhat - pi), 1), high: round(Math.max(0, yhat + pi), 1) };
  });
  return { status: 'ok', reason: `Linear trend over ${n} months with an ~80% prediction interval. A scenario, not a prediction of the whole market.`, method: 'ols-linear-trend', points };
}

type MarketFilters = { roleSlug?: string; includeDemo?: boolean; market?: string };
type JobRow = typeof jobs.$inferSelect;

const count = <T extends string>(arr: (T | null | undefined)[]) => {
  const m = new Map<string, number>();
  for (const a of arr) m.set(a ?? 'unknown', (m.get(a ?? 'unknown') ?? 0) + 1);
  return [...m.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
};
const monthOf = (r: JobRow) => (r.postedAt ? r.postedAt.slice(0, 7) : monthKey(r.firstSeenAt));

function webUrl(value: string | null) {
  try {
    const url = new URL(value ?? '');
    return ['https:', 'http:'].includes(url.protocol) ? url : null;
  } catch { return null; }
}

function sourceWebsite(s: typeof jobSources.$inferSelect) {
  if (s.type === 'greenhouse') return `https://boards.greenhouse.io/${encodeURIComponent(s.key.replace(/^greenhouse:/, ''))}`;
  if (s.type === 'lever') return `https://jobs.lever.co/${encodeURIComponent(s.key.replace(/^lever:/, ''))}`;
  return webUrl(s.baseUrl)?.origin ?? null;
}

/** The public postings the market views aggregate over, plus lookup tables. */
async function loadMarket(ctx: AppContext, opts: MarketFilters) {
  const role = opts.roleSlug ? (await ctx.db.select().from(careerRoles).where(eq(careerRoles.slug, opts.roleSlug)))[0] : undefined;
  const conds = [isNull(jobs.ownerUserId)];
  if (!opts.includeDemo) conds.push(eq(jobs.isDemo, false));
  if (role) conds.push(eq(jobs.normalizedRoleId, role.id));
  if (opts.market) conds.push(eq(jobs.market, opts.market));
  const rows = await ctx.db.select().from(jobs).where(and(...conds));
  const roles = await ctx.db.select({ id: careerRoles.id, name: careerRoles.name, slug: careerRoles.slug }).from(careerRoles);
  const skillNames = new Map((await ctx.db.select({ slug: skills.slug, name: skills.name }).from(skills)).map((s) => [s.slug, s.name]));
  const roleName = (r: JobRow) => roles.find((x) => x.id === r.normalizedRoleId)?.name ?? 'Unmapped titles';
  return { role, rows, roles, skillNames, roleName, active: rows.filter((r) => r.status === 'active') };
}

export type DrilldownDimension = 'total' | 'month' | 'role' | 'skill' | 'cert' | 'seniority' | 'market' | 'workMode' | 'salary' | 'source' | 'origin';

/** Details behind one bar, figure or tag on the market page: the matching postings and how they break down. */
export async function marketDrilldown(ctx: AppContext, opts: MarketFilters & { dimension: DrilldownDimension; key: string }) {
  const { rows, active, skillNames, roleName } = await loadMarket(ctx, opts);
  const sources = await ctx.db.select().from(jobSources);
  const k = opts.key;
  const hasSkill = (r: JobRow) => r.requiredSkills.includes(k) || r.preferredSkills.includes(k);
  const totals: Record<string, { title: string; description: string; base: JobRow[]; match: (r: JobRow) => boolean }> = {
    postings: { title: 'All postings', description: 'Every deduplicated public posting that matches the filters, active or not.', base: rows, match: () => true },
    active: { title: 'Active postings', description: 'Postings still listed at their source on the last sync.', base: rows, match: (r) => r.status === 'active' },
    withJdText: { title: 'Active postings with JD text', description: 'Only these contribute skill signals; the rest are counted from certification mentions only.', base: active, match: (r) => !!r.description.trim() },
    duplicatesMerged: { title: 'Postings with merged duplicates', description: 'The same job seen more than once (across sources or re-posts) is merged into one record.', base: rows, match: (r) => r.duplicateCount > 0 },
    freshness: { title: 'Freshness of active postings', description: 'Days since each active posting was last seen at its source.', base: active, match: () => true },
  };
  const spec: { title: string; description: string; base: JobRow[]; match: (r: JobRow) => boolean } = (() => {
    switch (opts.dimension) {
      case 'total': return totals[k] ?? totals.postings;
      case 'month': return { title: `Postings in ${k}`, description: 'By posted date, or first-seen date when the source gives none.', base: rows, match: (r) => monthOf(r) === k };
      case 'role': return { title: k, description: 'Active postings whose title maps to this role.', base: active, match: (r) => roleName(r) === k };
      case 'skill': return { title: skillNames.get(k) ?? k, description: 'Active postings that list this skill as required or preferred.', base: active, match: hasSkill };
      case 'cert': return { title: certById(k)?.shortName ?? k, description: certById(k)?.name ?? 'Active postings that mention this certification.', base: active, match: (r) => r.certifications.some((c) => c.id === k) };
      case 'seniority': return { title: `Seniority: ${k}`, description: 'Active postings at this level.', base: active, match: (r) => (r.seniority ?? 'unknown') === k };
      case 'market': return { title: `Market: ${k}`, description: 'Active postings in this market.', base: active, match: (r) => (r.market ?? 'unknown') === k };
      case 'workMode': return { title: `Work mode: ${k}`, description: 'Active postings with this work arrangement.', base: active, match: (r) => (r.workMode ?? 'unknown') === k };
      case 'salary': return { title: `Salaries in ${k}`, description: 'Active postings that state a salary in this currency.', base: active, match: (r) => !!r.salaryMin && r.salaryCurrency === k };
      case 'source': return { title: sources.find((s) => s.key === k)?.name ?? k, description: 'Postings ingested from this source.', base: rows, match: (r) => sources.find((s) => s.id === r.sourceId)?.key === k };
      case 'origin': return { title: `Upstream site: ${k}`, description: 'Postings originally published on this site.', base: rows, match: (r) => (r.originSite ?? 'unknown') === k };
    }
  })();
  const slice = spec.base.filter(spec.match);
  const now = ctx.now().getTime();
  const top = (arr: (string | null | undefined)[], n = 6) => count(arr).slice(0, n);

  let detail: { label: string; value: string }[] = [];
  if (opts.dimension === 'skill') detail = [{ label: 'Required', value: String(slice.filter((r) => r.requiredSkills.includes(k)).length) }, { label: 'Preferred only', value: String(slice.filter((r) => !r.requiredSkills.includes(k)).length) }];
  if (opts.dimension === 'cert') detail = (['required', 'preferred', 'mentioned'] as const).map((req) => ({ label: req[0].toUpperCase() + req.slice(1), value: String(slice.filter((r) => r.certifications.some((c) => c.id === k && c.requirement === req)).length) }));
  if (opts.dimension === 'salary' && slice.length) {
    const mids = slice.map((r) => (r.salaryMin! + (r.salaryMax ?? r.salaryMin!)) / 2).sort((a, b) => a - b);
    detail = [{ label: 'Lowest midpoint', value: Math.round(mids[0]).toLocaleString() }, { label: 'Median midpoint', value: Math.round(mids[Math.floor(mids.length / 2)]).toLocaleString() }, { label: 'Highest midpoint', value: Math.round(mids.at(-1)!).toLocaleString() }];
  }
  if (opts.dimension === 'total' && k === 'freshness' && slice.length) {
    const ages = slice.map((r) => (now - r.lastSeenAt.getTime()) / 86_400_000);
    const buckets: [string, number, number][] = [['≤ 7 days', -Infinity, 7], ['8–30 days', 7, 30], ['31–90 days', 30, 90], ['> 90 days', 90, Infinity]];
    detail = buckets.map(([label, lo, hi]) => ({ label, value: String(ages.filter((a) => a > lo && a <= hi).length) }));
  }

  return {
    title: spec.title,
    description: spec.description,
    count: slice.length,
    base: spec.base.length,
    share: spec.base.length ? round((slice.length / spec.base.length) * 100, 1) : 0,
    detail,
    breakdown: {
      role: opts.dimension === 'role' ? [] : top(slice.map(roleName)),
      skill: opts.dimension === 'skill' ? [] : top(slice.flatMap((r) => [...new Set([...r.requiredSkills, ...r.preferredSkills])])).map((x) => ({ ...x, label: skillNames.get(x.key) ?? x.key })),
      cert: opts.dimension === 'cert' ? [] : top(slice.flatMap((r) => r.certifications.map((c) => c.id))).map((x) => ({ ...x, label: certById(x.key)?.shortName ?? x.key })),
      seniority: opts.dimension === 'seniority' ? [] : top(slice.map((r) => r.seniority)),
      market: opts.dimension === 'market' ? [] : top(slice.map((r) => r.market)),
      workMode: opts.dimension === 'workMode' ? [] : top(slice.map((r) => r.workMode)),
      company: top(slice.map((r) => r.company), 8),
    },
    postings: [...slice].sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime()).slice(0, 25).map((r) => ({
      id: r.id, title: r.title, company: r.company, market: r.market, seniority: r.seniority, workMode: r.workMode, status: r.status, isDemo: r.isDemo,
      postedAt: r.postedAt, daysSinceSeen: round((now - r.lastSeenAt.getTime()) / 86_400_000, 0),
      source: sources.find((s) => s.id === r.sourceId)?.name ?? null, originSite: r.originSite,
      url: r.isDemo ? null : webUrl(r.canonicalUrl)?.href ?? null,
    })),
  };
}

export async function marketOverview(ctx: AppContext, opts: MarketFilters) {
  const { role, rows, skillNames, roleName, active } = await loadMarket(ctx, opts);

  // ---- Historical observations (deduplicated postings by first-seen / posted month)
  const byMonth = count(rows.map(monthOf)).sort((a, b) => a.key.localeCompare(b.key));
  const volumeByRole = count(active.map(roleName)).slice(0, 15);
  const obs = await ctx.db.select().from(marketObservations).where(eq(marketObservations.metric, 'postings'));
  const roleKeys = role ? role.certTrendsRoleIds : [...new Set(obs.map((o) => o.roleKey))];
  const aggSeries = roleKeys.map((rk) => {
    const m = new Map<string, number>();
    for (const o of obs.filter((x) => x.roleKey === rk && (!opts.market || x.market === opts.market))) m.set(o.period, (m.get(o.period) ?? 0) + o.value);
    const series = [...m.entries()].map(([period, value]) => ({ period, value })).sort((a, b) => a.period.localeCompare(b.period));
    return { roleKey: rk, series, months: series.filter((s) => s.value > 0).length };
  });

  // ---- Current signals
  const withText = active.filter((r) => r.description.trim()).length;
  const skillCounts = new Map<string, { required: number; preferred: number }>();
  for (const r of active) {
    for (const s of r.requiredSkills) skillCounts.set(s, { required: (skillCounts.get(s)?.required ?? 0) + 1, preferred: skillCounts.get(s)?.preferred ?? 0 });
    for (const s of r.preferredSkills) skillCounts.set(s, { required: skillCounts.get(s)?.required ?? 0, preferred: (skillCounts.get(s)?.preferred ?? 0) + 1 });
  }
  const topSkills = [...skillCounts.entries()].map(([slug, c]) => ({ slug, name: skillNames.get(slug) ?? slug, ...c, share: active.length ? round(((c.required + c.preferred) / active.length) * 100, 1) : 0 })).sort((a, b) => b.required + b.preferred - (a.required + a.preferred)).slice(0, 20);
  const certCounts = new Map<string, { required: number; preferred: number; mentioned: number }>();
  for (const r of active) for (const c of r.certifications) {
    const e = certCounts.get(c.id) ?? { required: 0, preferred: 0, mentioned: 0 };
    e[c.requirement]++;
    certCounts.set(c.id, e);
  }
  const certifications = [...certCounts.entries()].map(([id, c]) => ({ id, name: certById(id)?.shortName ?? id, ...c, total: c.required + c.preferred + c.mentioned })).sort((a, b) => b.total - a.total).slice(0, 15);
  const salaries = active.filter((r) => r.salaryMin && r.salaryCurrency);
  const byCurrency = new Map<string, number[]>();
  for (const s of salaries) byCurrency.set(s.salaryCurrency!, [...(byCurrency.get(s.salaryCurrency!) ?? []), (s.salaryMin! + (s.salaryMax ?? s.salaryMin!)) / 2]);
  const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

  // Emerging skills: share in the last 30 days vs the 60 days before, with minimum sample sizes.
  const now = ctx.now().getTime();
  const recent = active.filter((r) => now - r.firstSeenAt.getTime() <= 30 * 86_400_000);
  const prior = active.filter((r) => { const d = now - r.firstSeenAt.getTime(); return d > 30 * 86_400_000 && d <= 90 * 86_400_000; });
  let emerging: { status: 'ok' | 'insufficient'; reason: string; skills: { slug: string; name: string; recentShare: number; priorShare: number }[] } = { status: 'insufficient', reason: `Need at least 20 postings in each window (have ${recent.length} recent, ${prior.length} prior, by first-seen date).`, skills: [] };
  if (recent.length >= 20 && prior.length >= 20) {
    const share = (set: typeof active, s: string) => set.filter((r) => r.requiredSkills.includes(s) || r.preferredSkills.includes(s)).length / set.length;
    const all = [...new Set(recent.flatMap((r) => [...r.requiredSkills, ...r.preferredSkills]))];
    emerging = { status: 'ok', reason: 'Skills whose share of postings grew by ≥5 percentage points (last 30 days vs the prior 60).', skills: all.map((s) => ({ slug: s, name: skillNames.get(s) ?? s, recentShare: round(share(recent, s) * 100, 1), priorShare: round(share(prior, s) * 100, 1) })).filter((x) => x.recentShare - x.priorShare >= 5).sort((a, b) => b.recentShare - b.priorShare - (a.recentShare - a.priorShare)).slice(0, 10) };
  }

  // ---- Coverage & freshness
  const sources = await ctx.db.select().from(jobSources);
  const certTrendsIds = new Set(sources.filter((x) => x.type === 'cert_trends').map((x) => x.id));
  const fromCertTrends = rows.filter((r) => certTrendsIds.has(r.sourceId)).length;
  const ages = active.map((r) => (now - r.lastSeenAt.getTime()) / 86_400_000).sort((a, b) => a - b);

  // ---- Forecast scenarios (statistical, only when the series supports it)
  const forecastSeries = role && aggSeries.length
    ? aggSeries.reduce<{ period: string; value: number }[]>((acc, s) => { for (const p of s.series) { const e = acc.find((x) => x.period === p.period); if (e) e.value += p.value; else acc.push({ ...p }); } return acc; }, [])
    : byMonth.map((m) => ({ period: m.key, value: m.value }));
  // Only months with observed data count as history; leading zero months are padding, not observations.
  const firstNonZero = forecastSeries.sort((a, b) => a.period.localeCompare(b.period)).findIndex((p) => p.value > 0);
  const forecast = linearForecast(firstNonZero >= 0 ? forecastSeries.slice(firstNonZero) : []);

  return {
    filters: { role: role ? { slug: role.slug, name: role.name } : null, includeDemo: !!opts.includeDemo, market: opts.market ?? null },
    totals: { postings: rows.length, active: active.length, withJdText: withText, demo: rows.filter((r) => r.isDemo).length, duplicatesMerged: rows.reduce((s, r) => s + r.duplicateCount, 0) },
    historical: { postingsByMonth: byMonth, roleAggregates: aggSeries, note: 'Counts are deduplicated postings by posted (or first-seen) month from ingested sources only.' },
    current: {
      volumeByRole, topSkills, certifications,
      seniority: count(active.map((r) => r.seniority)), markets: count(active.map((r) => r.market)), workModes: count(active.map((r) => r.workMode)),
      salary: byCurrency.size ? [...byCurrency.entries()].map(([currency, v]) => ({ currency, postings: v.length, medianMidpoint: Math.round(median(v)) })) : [],
      salaryNote: byCurrency.size ? 'Only postings that state a salary explicitly are included.' : 'No explicit salary data in the ingested postings.',
      emerging,
      skillCoverageNote: `${withText} of ${active.length} active postings include JD text; for the rest, skill signals come only from certification mentions.`,
      sampleNote: fromCertTrends ? `${fromCertTrends} of ${rows.length} postings come from Cert Trends, which publishes only postings that name a certification — a filtered sample, so certification-heavy roles are over-represented. Unfiltered role-demand counts are under Historical observations (role aggregates).` : null,
    },
    forecast,
    coverage: {
      sources: sources.filter((s) => s.type !== 'manual' && (opts.includeDemo || !s.isDemo)).map((s) => ({ key: s.key, name: s.name, type: s.type, websiteUrl: sourceWebsite(s), isDemo: s.isDemo, lastSyncAt: s.lastSyncAt, lastSyncStatus: s.lastSyncStatus, lastSyncMessage: s.lastSyncMessage, postings: rows.filter((r) => r.sourceId === s.id).length })),
      websites: (() => {
        const sites = new Map<string, { name: string; url: string; postings: number }>();
        for (const r of rows.filter((r) => !r.isDemo)) {
          const url = webUrl(r.canonicalUrl);
          if (!url) continue;
          const site = sites.get(url.origin) ?? { name: r.originSite ?? url.hostname, url: url.origin, postings: 0 };
          site.postings++;
          sites.set(url.origin, site);
        }
        return [...sites.values()].sort((a, b) => b.postings - a.postings);
      })(),
      origins: count(rows.map((r) => r.originSite)).slice(0, 15),
      medianDaysSinceSeen: ages.length ? round(ages[Math.floor(ages.length / 2)], 1) : null,
    },
  };
}
