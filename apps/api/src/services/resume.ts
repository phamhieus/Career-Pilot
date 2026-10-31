import { and, desc, eq, inArray, max } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import {
  careerProfiles, careerRoles, jobs, profileItems, resumeEvidence, resumes, resumeVersions, skills, userSkills, users,
  type ResumeBullet, type ResumeContent, type ResumeQuality, type ResumeSection,
} from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { uid } from '../lib/text.js';
import type { Taxonomy } from './taxonomy.js';

export const TEMPLATES = [
  { key: 'classic', name: 'Classic (single column)', atsNote: 'Single column, standard headings and real text — parses reliably.', score: 100 },
  { key: 'compact', name: 'Compact (single column, dense)', atsNote: 'Single column with tighter spacing — parses reliably.', score: 100 },
  { key: 'modern', name: 'Modern (two-column sidebar)', atsNote: 'Two-column layouts can be read out of order by some applicant tracking systems.', score: 75 },
] as const;

const TITLES: Record<'en' | 'vi', Record<ResumeSection['type'], string>> = {
  en: { summary: 'Summary', experience: 'Experience', projects: 'Projects', education: 'Education', certifications: 'Certifications', skills: 'Skills' },
  vi: { summary: 'Giới thiệu', experience: 'Kinh nghiệm làm việc', projects: 'Dự án', education: 'Học vấn', certifications: 'Chứng chỉ', skills: 'Kỹ năng' },
};

const bulletSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().max(600),
  evidence: z.array(z.object({ type: z.enum(['profile_item', 'skill', 'profile']), id: z.number().int() })).max(20),
  status: z.enum(['supported', 'needs_confirmation']).optional(),
  issues: z.array(z.string()).optional(),
  locked: z.boolean().optional(),
  originalText: z.string().max(600).optional(),
  userConfirmed: z.boolean().optional(),
});
export const contentSchema = z.object({
  header: z.object({ name: z.string().max(120), headline: z.string().max(200), email: z.string().max(160).optional(), location: z.string().max(120).optional(), links: z.array(z.string().max(200)).max(5).optional() }),
  sections: z.array(z.object({
    id: z.string().max(40),
    type: z.enum(['summary', 'experience', 'projects', 'education', 'certifications', 'skills']),
    title: z.string().max(80),
    locked: z.boolean().optional(),
    entries: z.array(z.object({ id: z.string().max(40), profileItemId: z.number().int().optional(), heading: z.string().max(200).optional(), subheading: z.string().max(200).optional(), period: z.string().max(60).optional(), bullets: z.array(bulletSchema).max(30) })).max(40),
  })).max(12),
});

const period = (s: string | null, e: string | null, lang: 'en' | 'vi') => [s ?? '', e ?? (s ? (lang === 'vi' ? 'Hiện tại' : 'Present') : '')].filter(Boolean).join(' – ');
const NUMBER_RE = /\d+(?:[.,]\d+)?\s?%?/g;

/** Checks a (possibly rewritten) bullet against its source evidence text. Pure; exported for tests. */
export function validateAgainstSource(text: string, sourceText: string, tax: Taxonomy, allowedSkills: string[]): string[] {
  const issues: string[] = [];
  const srcNums = new Set((sourceText.match(NUMBER_RE) ?? []).map((n) => n.replace(/\s/g, '')));
  for (const n of text.match(NUMBER_RE) ?? []) if (!srcNums.has(n.replace(/\s/g, ''))) issues.push(`Number "${n.trim()}" does not appear in the source evidence.`);
  const srcSkills = new Set([...tax.findSkills(sourceText), ...allowedSkills]);
  for (const s of tax.findSkills(text)) if (!srcSkills.has(s)) issues.push(`Mentions ${tax.bySlug.get(s)?.name ?? s}, which is not in the source evidence.`);
  return issues;
}

interface Sources { profile: typeof careerProfiles.$inferSelect | undefined; user: typeof users.$inferSelect; items: (typeof profileItems.$inferSelect)[]; userSkillRows: { slug: string; name: string; category: string; id: number; status: string; proficiency: number | null }[] }

async function loadSources(ctx: AppContext, userId: number): Promise<Sources & { unconfirmed: number }> {
  const [user] = await ctx.db.select().from(users).where(eq(users.id, userId));
  const [profile] = await ctx.db.select().from(careerProfiles).where(eq(careerProfiles.userId, userId));
  const all = await ctx.db.select().from(profileItems).where(eq(profileItems.userId, userId));
  const us = await ctx.db.select({ slug: skills.slug, name: skills.name, category: skills.category, id: skills.id, status: userSkills.status, proficiency: userSkills.proficiency }).from(userSkills).innerJoin(skills, eq(skills.id, userSkills.skillId)).where(eq(userSkills.userId, userId));
  return { user, profile, items: all.filter((i) => i.confirmed), userSkillRows: us, unconfirmed: all.filter((i) => !i.confirmed).length };
}

function sourceTextFor(b: ResumeBullet, src: Sources): string {
  return b.evidence.map((e) => {
    if (e.type === 'profile_item') { const it = src.items.find((i) => i.id === e.id); return it ? [it.title, it.organization, it.description, ...it.highlights, it.skillSlugs.join(' ')].join('\n') : ''; }
    if (e.type === 'skill') return src.userSkillRows.find((s) => s.id === e.id)?.name ?? '';
    return `${src.profile?.headline ?? ''}\n${src.profile?.summary ?? ''}`;
  }).join('\n');
}

function allowedSkillsFor(b: ResumeBullet, src: Sources): string[] {
  return b.evidence.flatMap((e) => (e.type === 'profile_item' ? src.items.find((i) => i.id === e.id)?.skillSlugs ?? [] : e.type === 'skill' ? [src.userSkillRows.find((s) => s.id === e.id)?.slug ?? ''] : []));
}

/** Validates every bullet's evidence references and content; marks unsupported claims. */
export function validateContent(content: ResumeContent, src: Sources, tax: Taxonomy): ResumeContent {
  const copy: ResumeContent = structuredClone(content);
  for (const sec of copy.sections) for (const en of sec.entries) for (const b of en.bullets) {
    const issues: string[] = [];
    b.evidence = b.evidence.filter((e) => (e.type === 'profile_item' ? src.items.some((i) => i.id === e.id) : e.type === 'skill' ? src.userSkillRows.some((s) => s.id === e.id) : e.id === src.user.id));
    if (!b.evidence.length) issues.push('No linked source evidence — link it to a profile entry or confirm it.');
    else {
      // Skill lines are "Category: a, b" — the category label is generated, so only the listed skills are checked.
      const text = sec.type === 'skills' ? b.text.replace(/^[^:]{1,40}:\s*/, '') : b.text;
      issues.push(...validateAgainstSource(text, sourceTextFor(b, src), tax, sec.type === 'skills' ? src.userSkillRows.map((s) => s.slug) : allowedSkillsFor(b, src)));
    }
    const confirmed = (b as ResumeBullet & { userConfirmed?: boolean }).userConfirmed;
    b.issues = issues;
    b.status = issues.length && !confirmed ? 'needs_confirmation' : 'supported';
  }
  return copy;
}

function buildMasterContent(src: Sources, lang: 'en' | 'vi'): ResumeContent {
  const T = TITLES[lang];
  const sections: ResumeSection[] = [];
  const b = (text: string, evidence: ResumeBullet['evidence']): ResumeBullet => ({ id: uid('b'), text, evidence, status: 'supported' });
  if (src.profile?.summary) sections.push({ id: uid('s'), type: 'summary', title: T.summary, entries: [{ id: uid('e'), bullets: [b(src.profile.summary, [{ type: 'profile', id: src.user.id }])] }] });
  const byDate = (a: typeof src.items[number], c: typeof src.items[number]) => (c.startDate ?? '').localeCompare(a.startDate ?? '');
  const entryFor = (it: typeof src.items[number]) => ({
    id: uid('e'), profileItemId: it.id, heading: it.title, subheading: it.organization, period: period(it.startDate, it.endDate, lang),
    bullets: (it.highlights.length ? it.highlights : it.description ? [it.description] : []).map((h) => b(h, [{ type: 'profile_item', id: it.id }])),
  });
  const work = src.items.filter((i) => i.kind === 'work').sort(byDate);
  if (work.length) sections.push({ id: uid('s'), type: 'experience', title: T.experience, entries: work.map(entryFor) });
  const projects = src.items.filter((i) => i.kind === 'project').sort(byDate);
  if (projects.length) sections.push({ id: uid('s'), type: 'projects', title: T.projects, entries: projects.map(entryFor) });
  const edu = src.items.filter((i) => i.kind === 'education').sort(byDate);
  if (edu.length) sections.push({ id: uid('s'), type: 'education', title: T.education, entries: edu.map((it) => ({ ...entryFor(it), bullets: it.description ? [b(it.description, [{ type: 'profile_item', id: it.id }])] : [] })) });
  const certs = src.items.filter((i) => i.kind === 'certification').sort(byDate);
  if (certs.length) sections.push({ id: uid('s'), type: 'certifications', title: T.certifications, entries: [{ id: uid('e'), bullets: certs.map((c) => b([c.title, c.organization, c.startDate?.slice(0, 4)].filter(Boolean).join(' — '), [{ type: 'profile_item', id: c.id }])) }] });
  if (src.userSkillRows.length) sections.push({ id: uid('s'), type: 'skills', title: T.skills, entries: [{ id: uid('e'), bullets: skillBullets(src.userSkillRows, []) }] });
  return { header: { name: src.user.displayName, headline: src.profile?.headline ?? '', email: src.user.email, location: src.profile?.location || undefined }, sections };
}

const STATUS_ORDER: Record<string, number> = { app_verified: 0, assessed: 1, self_reported: 2, extracted_claim: 3 };
function skillBullets(rows: Sources['userSkillRows'], priority: string[]): ResumeBullet[] {
  const byCat = new Map<string, typeof rows>();
  const sorted = [...rows].sort((a, c) => Number(priority.includes(c.slug)) - Number(priority.includes(a.slug)) || STATUS_ORDER[a.status] - STATUS_ORDER[c.status]);
  for (const r of sorted) byCat.set(r.category, [...(byCat.get(r.category) ?? []), r]);
  const cats = [...byCat.entries()].sort((a, c) => Number(c[1].some((r) => priority.includes(r.slug))) - Number(a[1].some((r) => priority.includes(r.slug))));
  return cats.map(([cat, list]) => ({ id: uid('b'), text: `${cat}: ${list.map((l) => l.name).join(', ')}`, evidence: list.map((l) => ({ type: 'skill' as const, id: l.id })), status: 'supported' as const }));
}

export function analyzeQuality(content: ResumeContent, template: string, job: typeof jobs.$inferSelect | null, tax: Taxonomy, unconfirmedProfileItems = 0): ResumeQuality {
  const bullets = content.sections.flatMap((s) => s.entries.flatMap((e) => e.bullets.map((b) => ({ b, section: s.type }))));
  const allText = [content.header.headline, ...bullets.map((x) => x.b.text)].join('\n');
  let jdRelevance: ResumeQuality['jdRelevance'] = { score: null, matched: [], missing: [], note: 'No job selected — relevance is measured for tailored CVs.' };
  if (job) {
    const found = new Set(tax.findSkills(allText));
    const req = job.requiredSkills, pref = job.preferredSkills;
    const total = req.length * 2 + pref.length;
    const got = req.filter((s) => found.has(s)).length * 2 + pref.filter((s) => found.has(s)).length;
    const name = (s: string) => tax.bySlug.get(s)?.name ?? s;
    jdRelevance = { score: total ? Math.round((got / total) * 100) : null, matched: [...req, ...pref].filter((s) => found.has(s)).map(name), missing: [...req, ...pref].filter((s) => !found.has(s)).map(name), note: 'Missing items are not added automatically: add them only if your profile has real evidence.' };
  }
  const issues: string[] = [];
  const prose = bullets.filter((x) => x.section !== 'skills' && x.section !== 'certifications');
  let clear = 0;
  for (const { b } of prose) {
    const words = b.text.split(/\s+/).filter(Boolean).length;
    const problems = [];
    if (words > 40) problems.push('long (>40 words)');
    if (words < 5) problems.push('very short');
    if (/^(i|we|my)\b/i.test(b.text) || /\b(I|tôi)\b/.test(b.text)) problems.push('uses first person');
    if (/responsible for|helped with|worked on/i.test(b.text)) problems.push('passive phrasing; lead with an action verb');
    if (problems.length) issues.push(`"${b.text.slice(0, 50)}…": ${problems.join(', ')}`);
    else clear++;
  }
  const types = new Set(content.sections.filter((s) => s.entries.some((e) => e.bullets.length || e.heading)).map((s) => s.type));
  const missingSections = (['summary', 'experience', 'skills', 'education'] as const).filter((t) => !types.has(t) && !(t === 'experience' && types.has('projects')));
  if (!content.header.email) missingSections.push('contact email' as never);
  const tpl = TEMPLATES.find((t) => t.key === template) ?? TEMPLATES[0];
  const supported = bullets.filter((x) => x.b.status === 'supported').length;
  const notes: string[] = [tpl.atsNote, 'Exports contain selectable text with standard section headings.'];
  if (unconfirmedProfileItems) notes.push(`${unconfirmedProfileItems} imported profile item(s) await your confirmation and were excluded.`);
  return {
    jdRelevance,
    clarity: { score: prose.length ? Math.round((clear / prose.length) * 100) : 100, issues: issues.slice(0, 12) },
    completeness: { score: Math.round(((5 - missingSections.length) / 5) * 100), missingSections },
    formatCompatibility: { score: tpl.score, notes },
    evidenceCoverage: { score: bullets.length ? Math.round((supported / bullets.length) * 100) : 0, supported, total: bullets.length },
    unverifiedClaims: bullets.filter((x) => x.b.status === 'needs_confirmation').map((x) => ({ bulletId: x.b.id, text: x.b.text, issues: x.b.issues ?? [] })),
    disclaimer: 'No tool can guarantee passing an applicant tracking system or a recruiter screen; these checks cover common relevance, clarity and parsing issues.',
  };
}

async function insertVersion(ctx: AppContext, resume: typeof resumes.$inferSelect, content: ResumeContent, note: string, createdBy: 'user' | 'generator', generatedBy: string | null) {
  const tax = await ctx.taxonomy();
  const src = await loadSources(ctx, resume.userId);
  const validated = validateContent(content, src, tax);
  const job = resume.jobId ? (await ctx.db.select().from(jobs).where(eq(jobs.id, resume.jobId)))[0] ?? null : null;
  const quality = analyzeQuality(validated, resume.template, job, tax, src.unconfirmed);
  const [{ v }] = await ctx.db.select({ v: max(resumeVersions.versionNo) }).from(resumeVersions).where(eq(resumeVersions.resumeId, resume.id));
  const [version] = await ctx.db.insert(resumeVersions).values({ resumeId: resume.id, versionNo: (v ?? 0) + 1, note, content: validated, quality, createdBy, generatedBy }).returning();
  const links = validated.sections.flatMap((s) => s.entries.flatMap((e) => e.bullets.flatMap((b) => b.evidence.map((ev) => ({ versionId: version.id, bulletId: b.id, sourceType: ev.type, sourceId: ev.id })))));
  if (links.length) await ctx.db.insert(resumeEvidence).values(links);
  await ctx.db.update(resumes).set({ currentVersionId: version.id, updatedAt: ctx.now() }).where(eq(resumes.id, resume.id));
  return version;
}

export async function createMasterResume(ctx: AppContext, userId: number, input: { title?: string; language?: 'en' | 'vi'; template?: string }) {
  const lang = input.language ?? 'en';
  const src = await loadSources(ctx, userId);
  if (!src.items.length && !src.profile?.summary) throw badRequest('Add confirmed experience, projects or a summary to your profile first.');
  const [resume] = await ctx.db.insert(resumes).values({ userId, title: input.title ?? (lang === 'vi' ? 'CV tổng (Master)' : 'Master CV'), kind: 'master', template: input.template ?? 'classic', language: lang }).returning();
  const version = await insertVersion(ctx, resume, buildMasterContent(src, lang), 'Generated from confirmed profile data', 'generator', null);
  return { resume: { ...resume, currentVersionId: version.id }, version };
}

export async function createTailoredResume(ctx: AppContext, userId: number, input: { jobId: number; baseResumeId?: number; language?: 'en' | 'vi'; template?: string; title?: string }) {
  const lang = input.language ?? 'en';
  const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, input.jobId));
  if (!job || (job.ownerUserId && job.ownerUserId !== userId)) throw notFound('Job');
  const role = job.normalizedRoleId ? (await ctx.db.select().from(careerRoles).where(eq(careerRoles.id, job.normalizedRoleId)))[0] : undefined;
  let base: typeof resumes.$inferSelect | undefined;
  if (input.baseResumeId) {
    [base] = await ctx.db.select().from(resumes).where(and(eq(resumes.id, input.baseResumeId), eq(resumes.userId, userId)));
    if (!base) throw notFound('Base resume');
  }
  const [resume] = await ctx.db.insert(resumes).values({ userId, title: input.title ?? `${job.title} — ${job.company}`, kind: 'tailored', jobId: job.id, baseResumeId: base?.id ?? null, template: input.template ?? base?.template ?? 'classic', language: lang }).returning();
  const { content, generatedBy } = await tailorContent(ctx, userId, job, role?.name ?? job.title, lang, null);
  const version = await insertVersion(ctx, resume, content, `Tailored for ${job.title} at ${job.company}`, 'generator', generatedBy);
  return { resume: { ...resume, currentVersionId: version.id }, version };
}

/** Selection + rewriting. `locked` (from a previous version) is preserved verbatim. */
async function tailorContent(ctx: AppContext, userId: number, job: typeof jobs.$inferSelect, roleName: string, lang: 'en' | 'vi', locked: ResumeContent | null) {
  const tax = await ctx.taxonomy();
  const src = await loadSources(ctx, userId);
  const master = buildMasterContent(src, lang);
  const jd = new Set([...job.requiredSkills, ...job.preferredSkills]);
  const relevance = (text: string, itemSkills: string[] = []) => {
    const found = new Set([...tax.findSkills(text), ...itemSkills]);
    return [...found].reduce((s, x) => s + (job.requiredSkills.includes(x) ? 2 : jd.has(x) ? 1 : 0), 0);
  };
  for (const sec of master.sections) {
    if (sec.type === 'experience' || sec.type === 'projects') {
      for (const en of sec.entries) {
        const item = src.items.find((i) => i.id === en.profileItemId);
        en.bullets = en.bullets.map((b) => ({ b, r: relevance(b.text, item?.skillSlugs) })).sort((a, c) => c.r - a.r).slice(0, 5).map((x) => x.b);
      }
      if (sec.type === 'projects') {
        const scored = sec.entries.map((e) => ({ e, r: relevance(e.bullets.map((b) => b.text).join(' '), src.items.find((i) => i.id === e.profileItemId)?.skillSlugs) }));
        sec.entries = scored.filter((x) => x.r > 0 || scored.length <= 3).sort((a, c) => c.r - a.r).slice(0, 3).map((x) => x.e);
      }
    }
    if (sec.type === 'skills') sec.entries = [{ id: uid('e'), bullets: skillBullets(src.userSkillRows, [...jd]) }];
  }
  master.sections = master.sections.filter((s) => s.entries.length);

  const targetSkills = [...jd].filter((s) => src.userSkillRows.some((u) => u.slug === s)).map((s) => tax.bySlug.get(s)?.name ?? s);
  const toRewrite: { id: string; text: string; source: string }[] = [];
  for (const sec of master.sections) if (sec.type === 'experience' || sec.type === 'projects') for (const en of sec.entries) for (const b of en.bullets) toRewrite.push({ id: b.id, text: b.text, source: sourceTextFor(b, src) });
  const rewritten = await ctx.ai.rewriteBullets({ bullets: toRewrite, targetSkills, language: lang });
  const summary = src.profile?.summary ? await ctx.ai.writeSummary({ source: src.profile.summary, roleName, skills: targetSkills, language: lang }) : null;
  for (const sec of master.sections) for (const en of sec.entries) for (const b of en.bullets) {
    const r = rewritten.data.find((x) => x.id === b.id);
    if (r && r.text !== b.text) { b.originalText = b.text; b.text = r.text; }
    if (sec.type === 'summary' && summary?.data && summary.data !== b.text) { b.originalText = b.text; b.text = summary.data; }
  }
  // Preserve locked sections/bullets from the previous version.
  if (locked) {
    for (const ls of locked.sections) {
      const idx = master.sections.findIndex((s) => s.type === ls.type);
      if (ls.locked) { if (idx >= 0) master.sections[idx] = ls; else master.sections.push(ls); continue; }
      const lockedBullets = ls.entries.flatMap((e) => e.bullets.filter((b) => b.locked).map((b) => ({ e, b })));
      for (const { e, b } of lockedBullets) {
        const target = idx >= 0 ? master.sections[idx].entries.find((x) => x.profileItemId != null && x.profileItemId === e.profileItemId) ?? master.sections[idx].entries[0] : undefined;
        if (target && !target.bullets.some((x) => x.id === b.id)) target.bullets.unshift(b);
      }
    }
  }
  const generatedBy = rewritten.meta.mode === 'ai' ? `ai:${rewritten.meta.provider}` : `heuristic${rewritten.meta.fallbackReason ? ` (${rewritten.meta.fallbackReason})` : ''}`;
  return { content: master, generatedBy };
}

export async function regenerateTailored(ctx: AppContext, userId: number, resumeId: number) {
  const { resume, version } = await getResume(ctx, userId, resumeId);
  if (resume.kind !== 'tailored' || !resume.jobId) throw badRequest('Only tailored CVs can be regenerated against a job');
  const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, resume.jobId));
  const role = job.normalizedRoleId ? (await ctx.db.select().from(careerRoles).where(eq(careerRoles.id, job.normalizedRoleId)))[0] : undefined;
  const { content, generatedBy } = await tailorContent(ctx, userId, job, role?.name ?? job.title, resume.language, version.content);
  return insertVersion(ctx, resume, content, 'Regenerated (locked content preserved)', 'generator', generatedBy);
}

export async function saveResumeVersion(ctx: AppContext, userId: number, resumeId: number, input: { content: unknown; note?: string; template?: string; title?: string; language?: 'en' | 'vi' }) {
  const { resume } = await getResume(ctx, userId, resumeId);
  const parsed = contentSchema.safeParse(input.content);
  if (!parsed.success) throw badRequest('Invalid resume content', parsed.error.issues.slice(0, 5));
  const patch: Partial<typeof resumes.$inferInsert> = {};
  if (input.template && TEMPLATES.some((t) => t.key === input.template)) patch.template = input.template;
  if (input.title) patch.title = input.title.slice(0, 160);
  if (input.language) patch.language = input.language;
  const updated = Object.keys(patch).length ? (await ctx.db.update(resumes).set(patch).where(eq(resumes.id, resumeId)).returning())[0] : resume;
  return insertVersion(ctx, updated, parsed.data as ResumeContent, input.note?.slice(0, 200) || 'Edited', 'user', null);
}

export async function restoreVersion(ctx: AppContext, userId: number, resumeId: number, versionId: number) {
  const { resume } = await getResume(ctx, userId, resumeId);
  const [v] = await ctx.db.select().from(resumeVersions).where(and(eq(resumeVersions.id, versionId), eq(resumeVersions.resumeId, resumeId)));
  if (!v) throw notFound('Version');
  return insertVersion(ctx, resume, v.content, `Restored version ${v.versionNo}`, 'user', null);
}

export async function getResume(ctx: AppContext, userId: number, resumeId: number, versionId?: number) {
  const [resume] = await ctx.db.select().from(resumes).where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)));
  if (!resume) throw notFound('Resume');
  const vid = versionId ?? resume.currentVersionId;
  const [version] = await ctx.db.select().from(resumeVersions).where(and(eq(resumeVersions.resumeId, resumeId), eq(resumeVersions.id, vid!)));
  if (!version) throw notFound('Resume version');
  return { resume, version };
}

export async function getResumeDetail(ctx: AppContext, userId: number, resumeId: number) {
  const { resume, version } = await getResume(ctx, userId, resumeId);
  const versions = await ctx.db.select({ id: resumeVersions.id, versionNo: resumeVersions.versionNo, note: resumeVersions.note, createdBy: resumeVersions.createdBy, generatedBy: resumeVersions.generatedBy, createdAt: resumeVersions.createdAt }).from(resumeVersions).where(eq(resumeVersions.resumeId, resumeId)).orderBy(desc(resumeVersions.versionNo));
  const job = resume.jobId ? (await ctx.db.select({ id: jobs.id, title: jobs.title, company: jobs.company, isDemo: jobs.isDemo }).from(jobs).where(eq(jobs.id, resume.jobId)))[0] ?? null : null;
  const src = await loadSources(ctx, userId);
  return {
    resume, version, versions, job, templates: TEMPLATES,
    evidenceSources: {
      items: src.items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, organization: i.organization })),
      skills: src.userSkillRows.map((s) => ({ id: s.id, name: s.name, status: s.status })),
    },
  };
}

export async function listResumes(ctx: AppContext, userId: number) {
  const rows = await ctx.db.select().from(resumes).where(eq(resumes.userId, userId)).orderBy(desc(resumes.updatedAt));
  const ids = rows.map((r) => r.currentVersionId).filter((x): x is number => !!x);
  const vs = ids.length ? await ctx.db.select({ id: resumeVersions.id, versionNo: resumeVersions.versionNo, quality: resumeVersions.quality }).from(resumeVersions).where(inArray(resumeVersions.id, ids)) : [];
  const jobIds = rows.map((r) => r.jobId).filter((x): x is number => !!x);
  const js = jobIds.length ? await ctx.db.select({ id: jobs.id, title: jobs.title, company: jobs.company, isDemo: jobs.isDemo }).from(jobs).where(inArray(jobs.id, jobIds)) : [];
  return rows.map((r) => {
    const v = vs.find((x) => x.id === r.currentVersionId);
    return { ...r, versionNo: v?.versionNo ?? null, evidenceCoverage: v?.quality?.evidenceCoverage.score ?? null, jdRelevance: v?.quality?.jdRelevance.score ?? null, job: js.find((j) => j.id === r.jobId) ?? null };
  });
}

export async function deleteResume(ctx: AppContext, userId: number, resumeId: number) {
  await getResume(ctx, userId, resumeId);
  await ctx.db.delete(resumes).where(eq(resumes.id, resumeId));
}

