import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { userContext, type AppContext } from '../context.js';
import { careerRoles, jobSnapshots, jobSources, jobs, skills } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { cleanUntrustedText } from '../lib/text.js';
import * as auth from '../services/auth.js';
import * as catalog from '../services/catalog.js';
import { removeSelfReported, setSelfReported } from '../services/evidence.js';
import { computeJobMatch, loadJobMatchUser } from '../services/jobMatching.js';
import { knownCertifications } from '../services/jobs/certs.js';
import { ingestJobs } from '../services/jobs/ingest.js';
import { syncSource } from '../services/jobs/providers.js';
import { marketDrilldown, marketOverview } from '../services/market.js';
import { markSeen } from '../services/onboarding.js';
import { computeAllRoleMatches, computeRoleMatch } from '../services/matching.js';
import * as profile from '../services/profile.js';
import { TASK_DIMENSIONS, WORK_VALUES } from '../seed/data/roles.js';
import { idParam, parse, requireUser, SESSION_COOKIE } from './helpers.js';

export function coreRoutes(app: FastifyInstance, ctx: AppContext) {
  const uc = (req: FastifyRequest) => userContext(ctx, req.user?.id);
  const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: ctx.config.isProduction };

  // ---------------- Auth ----------------
  app.post('/api/auth/register', async (req, reply) => {
    const body = parse(z.object({ email: z.string().email().max(160), password: z.string().min(8).max(200), displayName: z.string().min(1).max(80) }), req.body);
    const user = await auth.register(ctx, body);
    const s = await auth.createSession(await uc(req), user.id);
    reply.setCookie(SESSION_COOKIE, s.token, { ...cookieOpts, expires: s.expiresAt });
    return { user: { id: user.id, email: user.email, displayName: user.displayName } };
  });
  app.post('/api/auth/login', async (req, reply) => {
    const body = parse(z.object({ email: z.string().max(160), password: z.string().max(200) }), req.body);
    const user = await auth.login(ctx, body.email, body.password);
    const s = await auth.createSession(await uc(req), user.id);
    reply.setCookie(SESSION_COOKIE, s.token, { ...cookieOpts, expires: s.expiresAt });
    return { user: { id: user.id, email: user.email, displayName: user.displayName } };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    await auth.destroySession(ctx, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
  app.get('/api/auth/me', async (req) => ({ user: req.user ? { id: req.user.id, email: req.user.email, displayName: req.user.displayName } : null }));

  // ---------------- Meta ----------------
  app.get('/api/meta', async (req) => ({
    ai: (await uc(req)).ai.status(),
    taskDimensions: TASK_DIMENSIONS,
    workValues: WORK_VALUES,
    skills: await ctx.db.select({ slug: skills.slug, name: skills.name, category: skills.category }).from(skills).orderBy(skills.name),
    roles: await ctx.db.select({ slug: careerRoles.slug, name: careerRoles.name }).from(careerRoles).orderBy(careerRoles.name),
  }));

  // ---------------- Atlas & graphs (public) ----------------
  app.get('/api/atlas', async () => catalog.listAtlas(ctx));
  app.get('/api/atlas/:slug', async (req) => {
    const slug = (req.params as { slug: string }).slug;
    const detail = await catalog.roleDetail(ctx, slug);
    if (req.user) await markSeen(ctx, req.user.id, `role:${slug}`);
    return detail;
  });
  app.get('/api/career-map', async () => catalog.careerMap(ctx));
  app.get('/api/roadmaps/:slug', async (req) => {
    const rm = await catalog.roadmapForUser(ctx, (req.params as { slug: string }).slug, req.user?.id ?? null);
    if (req.user) await markSeen(ctx, req.user.id, 'roadmap');
    return rm;
  });

  // ---------------- Profile ----------------
  app.get('/api/profile', async (req) => profile.getProfile(await uc(req), requireUser(req).id));
  app.patch('/api/profile', async (req) => profile.updateProfile(await uc(req), requireUser(req).id, parse(profile.profilePatchSchema, req.body)));
  app.post('/api/profile/items', async (req) => profile.createItem(await uc(req), requireUser(req).id, parse(profile.itemSchema, req.body)));
  app.patch('/api/profile/items/:id', async (req) => profile.updateItem(await uc(req), requireUser(req).id, idParam(req), parse(profile.itemSchema.partial(), req.body)));
  app.delete('/api/profile/items/:id', async (req) => { await profile.deleteItem(await uc(req), requireUser(req).id, idParam(req)); return { ok: true }; });
  app.put('/api/profile/skills/:slug', async (req) => {
    const { rating } = parse(z.object({ rating: z.number().int().min(1).max(5) }), req.body);
    return setSelfReported(await uc(req), requireUser(req).id, (req.params as { slug: string }).slug, rating);
  });
  app.delete('/api/profile/skills/:slug', async (req) => ({ result: await removeSelfReported(await uc(req), requireUser(req).id, (req.params as { slug: string }).slug) }));
  app.post('/api/profile/import-cv', async (req) => {
    const user = requireUser(req);
    let text: string;
    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) throw badRequest('No file uploaded');
      const buffer = await file.toBuffer();
      text = await profile.extractText({ buffer, mimetype: file.mimetype, filename: file.filename });
    } else {
      text = parse(z.object({ text: z.string().min(50).max(60000) }), req.body).text;
    }
    return profile.importCv(await uc(req), user.id, text);
  });
  app.post('/api/profile/sample', async (req) => profile.loadSampleProfile(await uc(req), requireUser(req).id));
  app.post('/api/profile/apply-discovery', async (req) => profile.applyDiscovery(await uc(req), requireUser(req).id, parse(z.object({ interests: z.array(z.string()).optional(), workValues: z.array(z.string()).optional(), taskAffinity: z.record(z.string(), z.number().int().min(1).max(5)).optional(), goals: z.string().max(600).optional() }), req.body)));
  app.get('/api/me/export', async (req, reply) => {
    const data = await profile.exportUserData(await uc(req), requireUser(req).id);
    return reply.header('content-disposition', 'attachment; filename="careerpilot-data.json"').send(data);
  });
  app.delete('/api/me', async (req, reply) => {
    await profile.deleteAccount(await uc(req), requireUser(req).id);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---------------- Matching ----------------
  app.get('/api/matching', async (req) => {
    const q = req.query as { includeDemo?: string };
    return computeAllRoleMatches(await uc(req), requireUser(req).id, { includeDemo: q.includeDemo === 'true' });
  });
  app.get('/api/matching/:slug', async (req) => {
    const q = parse(z.object({ level: z.enum(['junior', 'middle', 'senior']).optional(), includeDemo: z.enum(['true', 'false']).optional() }), req.query);
    const result = await computeRoleMatch(await uc(req), requireUser(req).id, (req.params as { slug: string }).slug, { level: q.level, includeDemo: q.includeDemo === 'true' });
    await markSeen(ctx, requireUser(req).id, 'matching');
    return result;
  });

  // ---------------- Jobs ----------------
  app.get('/api/jobs', async (req) => {
    const user = requireUser(req);
    const q = parse(z.object({ q: z.string().max(100).optional(), role: z.string().max(80).optional(), status: z.enum(['active', 'closed', 'unknown', 'all']).optional(), includeDemo: z.enum(['true', 'false']).optional(), source: z.string().max(80).optional(), market: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).optional(), offset: z.coerce.number().int().min(0).optional(), withMatch: z.enum(['true', 'false']).optional() }), req.query);
    const conds = [or(isNull(jobs.ownerUserId), eq(jobs.ownerUserId, user.id))!];
    if (q.includeDemo === 'false') conds.push(eq(jobs.isDemo, false));
    if (q.status !== 'all') conds.push(eq(jobs.status, q.status ?? 'active'));
    if (q.q) conds.push(or(ilike(jobs.title, `%${q.q}%`), ilike(jobs.company, `%${q.q}%`))!);
    if (q.market) conds.push(eq(jobs.market, q.market));
    if (q.role) {
      const [r] = await ctx.db.select({ id: careerRoles.id }).from(careerRoles).where(eq(careerRoles.slug, q.role));
      if (r) conds.push(eq(jobs.normalizedRoleId, r.id));
    }
    if (q.source) {
      const [s] = await ctx.db.select({ id: jobSources.id }).from(jobSources).where(eq(jobSources.key, q.source));
      if (s) conds.push(eq(jobs.sourceId, s.id));
    }
    const where = and(...conds);
    const [{ total }] = await ctx.db.select({ total: sql<number>`count(*)::int` }).from(jobs).where(where);
    const rows = await ctx.db.select().from(jobs).where(where).orderBy(desc(jobs.isDemo), desc(sql`length(${jobs.description}) > 0`), desc(jobs.lastSeenAt), desc(jobs.id)).limit(q.limit ?? 30).offset(q.offset ?? 0);
    const roleRows = await ctx.db.select({ id: careerRoles.id, slug: careerRoles.slug, name: careerRoles.name }).from(careerRoles);
    const srcRows = await ctx.db.select().from(jobSources);
    let matches = new Map<number, number | null>();
    if (q.withMatch === 'true' && rows.length) {
      const pre = await loadJobMatchUser(await uc(req), user.id);
      for (const r of rows) matches.set(r.id, (await computeJobMatch(await uc(req), user.id, r.id, pre)).score);
    }
    return {
      total,
      items: rows.map((r) => ({
        id: r.id, title: r.title, company: r.company, location: r.location, market: r.market, workMode: r.workMode, seniority: r.seniority, status: r.status,
        isDemo: r.isDemo, isPrivate: !!r.ownerUserId, postedAt: r.postedAt, lastSeenAt: r.lastSeenAt, url: r.canonicalUrl, originSite: r.originSite,
        source: srcRows.find((s) => s.id === r.sourceId)?.name, role: roleRows.find((x) => x.id === r.normalizedRoleId) ?? null,
        requiredSkills: r.requiredSkills, hasDescription: !!r.description.trim(), certifications: r.certifications, matchScore: matches.get(r.id) ?? null,
      })),
    };
  });
  app.get('/api/jobs/sources', async () => ctx.db.select().from(jobSources));
  app.post('/api/jobs/sources/:key/sync', async (req) => {
    requireUser(req);
    const body = parse(z.object({ useSnapshot: z.boolean().optional() }), req.body);
    return syncSource(ctx, (req.params as { key: string }).key, body);
  });
  app.post('/api/jobs/import', async (req) => {
    const user = requireUser(req);
    const body = parse(z.object({ text: z.string().min(80).max(30000), title: z.string().max(200).optional(), company: z.string().max(200).optional(), url: z.string().url().max(500).optional(), location: z.string().max(160).optional() }), req.body);
    const [manual] = await ctx.db.select().from(jobSources).where(eq(jobSources.key, 'manual'));
    const tax = await ctx.taxonomy();
    const parsed = await (await uc(req)).ai.parseJobDescription(body.text, tax, knownCertifications());
    const title = body.title || parsed.data.title || 'Untitled role';
    const stats = await ingestJobs(await uc(req), manual, [{
      externalId: `manual:${user.id}:${Date.now()}`, title, company: body.company || parsed.data.company || 'Unknown company', description: body.text,
      location: body.location || parsed.data.location || null, workMode: parsed.data.workMode, url: body.url ?? null, originSite: 'Manual import',
    }], { markMissing: false, ownerUserId: user.id, useAi: true });
    if (!stats.jobIds.length) throw badRequest(`Import failed: ${stats.errors.join('; ')}`);
    return { jobId: stats.jobIds[0], deduplicated: stats.inserted === 0, aiMeta: parsed.meta };
  });
  app.get('/api/jobs/:id', async (req) => {
    const user = requireUser(req);
    const id = idParam(req);
    const [job] = await ctx.db.select().from(jobs).where(and(eq(jobs.id, id), or(isNull(jobs.ownerUserId), eq(jobs.ownerUserId, user.id))));
    if (!job) throw notFound('Job');
    const [source] = await ctx.db.select().from(jobSources).where(eq(jobSources.id, job.sourceId));
    const role = job.normalizedRoleId ? (await ctx.db.select({ slug: careerRoles.slug, name: careerRoles.name }).from(careerRoles).where(eq(careerRoles.id, job.normalizedRoleId)))[0] : null;
    const snaps = await ctx.db.select({ id: jobSnapshots.id, capturedAt: jobSnapshots.capturedAt, contentHash: jobSnapshots.contentHash }).from(jobSnapshots).where(eq(jobSnapshots.jobId, id)).orderBy(desc(jobSnapshots.capturedAt));
    const skillRows = await ctx.db.select({ slug: skills.slug, name: skills.name }).from(skills).where(inArray(skills.slug, [...job.requiredSkills, ...job.preferredSkills, '__none__']));
    await markSeen(ctx, user.id, `job:${id}`);
    await markSeen(ctx, user.id, 'jobMatch');
    return { job: { ...job, dedupKey: undefined, contentHash: undefined }, source: source ? { key: source.key, name: source.name, type: source.type, isDemo: source.isDemo } : null, role, snapshots: snaps, skillNames: Object.fromEntries(skillRows.map((s) => [s.slug, s.name])), match: await computeJobMatch(await uc(req), user.id, id) };
  });
  app.post('/api/jobs/:id/description', async (req) => {
    // Enrich a description-less public posting with JD text the user pasted: creates a private copy.
    const user = requireUser(req);
    const id = idParam(req);
    const body = parse(z.object({ text: z.string().min(80).max(30000) }), req.body);
    const [job] = await ctx.db.select().from(jobs).where(and(eq(jobs.id, id), or(isNull(jobs.ownerUserId), eq(jobs.ownerUserId, user.id))));
    if (!job) throw notFound('Job');
    const [manual] = await ctx.db.select().from(jobSources).where(eq(jobSources.key, 'manual'));
    const stats = await ingestJobs(await uc(req), manual, [{ externalId: `enrich:${job.id}:${user.id}`, title: job.title, company: job.company, description: cleanUntrustedText(body.text), location: job.location, market: job.market, country: job.country, workMode: job.workMode as 'remote' | null, url: job.canonicalUrl, originSite: `${job.originSite ?? 'Source'} + your pasted JD`, postedAt: job.postedAt, certifications: job.certifications.map((c) => ({ id: c.id, requirement: c.requirement })) }], { markMissing: false, ownerUserId: user.id, useAi: true });
    return { jobId: stats.jobIds[0] };
  });

  // ---------------- Market ----------------
  app.get('/api/market', async (req) => {
    const q = parse(z.object({ role: z.string().max(80).optional(), includeDemo: z.enum(['true', 'false']).optional(), market: z.string().max(40).optional() }), req.query);
    return marketOverview(ctx, { roleSlug: q.role, includeDemo: q.includeDemo === 'true', market: q.market });
  });
  app.get('/api/market/drilldown', async (req) => {
    const q = parse(z.object({
      role: z.string().max(80).optional(), includeDemo: z.enum(['true', 'false']).optional(), market: z.string().max(40).optional(),
      dimension: z.enum(['total', 'month', 'role', 'skill', 'cert', 'seniority', 'market', 'workMode', 'salary', 'source', 'origin']), key: z.string().min(1).max(200),
    }), req.query);
    return marketDrilldown(ctx, { roleSlug: q.role, includeDemo: q.includeDemo === 'true', market: q.market, dimension: q.dimension, key: q.key });
  });
}
