import { eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import {
  assessmentItems, careerFamilies, careerRoles, careerTransitions, jobSources, learningResources,
  roadmapEdges, roadmapNodes, roadmaps, roleSkillRequirements, skills,
} from '../db/schema.js';
import { layeredLayout, validateGraph, type Edge } from '../lib/graph.js';
import { ingestJobs } from '../services/jobs/ingest.js';
import { ITEMS } from './data/assessments.js';
import { DEMO_JOBS } from './data/demo-jobs.js';
import { RESOURCES } from './data/resources.js';
import { ROADMAPS, type CustomNode } from './data/roadmaps.js';
import { FAMILIES, ROLES, TRANSITIONS } from './data/roles.js';
import { SKILLS } from './data/skills.js';
import { SRC } from './data/sources.js';

export function parseRequirement(dsl: string) {
  const critical = dsl.startsWith('!');
  const [slug, weight, level] = dsl.replace(/^!/, '').split(':');
  return { slug, weight: Number(weight), level: Number(level), critical };
}

const VERIFY_SKILL = 'Checkpoint assessment: objective quiz ≥70% plus a scenario/practical item ≥70% (AI rubric) → App-Verified. Course completion alone never verifies a skill.';

/** Idempotent seed of catalog, roadmaps, assessments, job sources and labeled demo jobs. */
export async function seedDatabase(ctx: AppContext, opts: { demoJobs?: boolean } = {}) {
  const { db } = ctx;

  // Families
  for (const [i, f] of FAMILIES.entries()) {
    await db.insert(careerFamilies).values({ ...f, sortOrder: i }).onConflictDoUpdate({ target: careerFamilies.slug, set: { name: f.name, description: f.description, sortOrder: i } });
  }
  const famRows = await db.select().from(careerFamilies);
  const famId = new Map(famRows.map((f) => [f.slug, f.id]));

  // Skills
  const skillGraph = validateGraph(SKILLS.map((s) => s.slug), SKILLS.flatMap((s) => s.prereqs.map((p) => ({ from: p, to: s.slug }))));
  if (!skillGraph.valid) throw new Error(`Invalid skill prerequisite graph: ${JSON.stringify(skillGraph)}`);
  for (const s of SKILLS) {
    const values = {
      slug: s.slug, name: s.name, category: s.category, description: s.description, aliases: s.aliases, prerequisites: s.prereqs,
      baseHours: s.baseHours, learningOutcome: s.outcome, practiceTask: s.practice, frameworkRefs: s.refs ?? [],
    };
    await db.insert(skills).values(values).onConflictDoUpdate({ target: skills.slug, set: values });
  }
  const skillRows = await db.select().from(skills);
  const skillId = new Map(skillRows.map((s) => [s.slug, s.id]));
  const skillBySlug = new Map(skillRows.map((s) => [s.slug, s]));

  // Roles + requirement matrices
  for (const r of ROLES) {
    const values = {
      slug: r.slug, familyId: famId.get(r.family)!, name: r.name, summary: r.summary, purpose: r.purpose,
      details: {
        responsibilities: r.responsibilities, tools: r.tools, competencies: r.competencies,
        levels: { junior: r.levels[0], middle: r.levels[1], senior: r.levels[2] },
        collaboration: r.collaboration.map(([roleSlug, how]) => ({ roleSlug, how })),
        entryBarriers: r.entryBarriers, transitionsNote: r.transitionsNote,
        outlook: { observations: r.observations, predictions: r.predictions, speculation: r.speculation, aiImpact: r.aiImpact },
        sources: [...r.sources, SRC.esco, SRC.sfia].filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i),
        careerPaths: r.careerPaths,
      },
      taskProfile: r.task, workValues: r.values, minYears: { junior: r.minYears[0], middle: r.minYears[1], senior: r.minYears[2] },
      titleKeywords: r.titles, certTrendsRoleIds: r.certTrendsRoleIds ?? [],
    };
    await db.insert(careerRoles).values(values).onConflictDoUpdate({ target: careerRoles.slug, set: values });
  }
  const roleRows = await db.select().from(careerRoles);
  const roleId = new Map(roleRows.map((r) => [r.slug, r.id]));
  const roleReqs = new Map<string, ReturnType<typeof parseRequirement>[]>();
  for (const r of ROLES) {
    const reqs = r.requirements.map(parseRequirement);
    for (const q of reqs) if (!skillId.has(q.slug)) throw new Error(`Role ${r.slug} references unknown skill ${q.slug}`);
    roleReqs.set(r.slug, reqs);
    const rid = roleId.get(r.slug)!;
    await db.delete(roleSkillRequirements).where(eq(roleSkillRequirements.roleId, rid));
    await db.insert(roleSkillRequirements).values(reqs.map((q) => ({ roleId: rid, skillId: skillId.get(q.slug)!, weight: q.weight, requiredLevel: q.level, critical: q.critical })));
  }

  // Transitions (transferable skills = overlap of both matrices)
  for (const [from, to, difficulty, months, rationale] of TRANSITIONS) {
    if (!roleId.has(from) || !roleId.has(to)) throw new Error(`Transition references unknown role ${from} -> ${to}`);
    const fromSkills = new Set(roleReqs.get(from)!.map((q) => q.slug));
    const transferable = roleReqs.get(to)!.map((q) => q.slug).filter((s) => fromSkills.has(s));
    const values = { fromRoleId: roleId.get(from)!, toRoleId: roleId.get(to)!, difficulty, typicalMonths: months, transferableSkills: transferable, rationale };
    await db.insert(careerTransitions).values(values).onConflictDoUpdate({ target: [careerTransitions.fromRoleId, careerTransitions.toRoleId], set: values });
  }

  // Resources
  const existingRes = await db.select({ id: learningResources.id, url: learningResources.url, skillId: learningResources.skillId }).from(learningResources);
  const resKey = (sid: number | null, url: string) => `${sid}|${url}`;
  const haveRes = new Set(existingRes.map((r) => resKey(r.skillId, r.url)));
  const newRes = RESOURCES.filter(([slug, , url]) => !haveRes.has(resKey(skillId.get(slug) ?? null, url))).map(([slug, title, url, type, provider, free, hours]) => {
    if (!skillId.has(slug)) throw new Error(`Resource references unknown skill ${slug}`);
    return { skillId: skillId.get(slug)!, title, url, type, provider, free, estimatedHours: hours ?? null };
  });
  if (newRes.length) await db.insert(learningResources).values(newRes);
  const resRows = await db.select().from(learningResources);
  const resourcesForSkill = (sid: number) => resRows.filter((r) => r.skillId === sid).map((r) => r.id);

  // Roadmaps (curated + auto-generated from requirement matrices for remaining roles)
  const curatedRoles = new Set(ROADMAPS.map((r) => r.role));
  const autoSeeds = ROLES.filter((r) => !curatedRoles.has(r.slug)).map((r) => {
    const reqSlugs = roleReqs.get(r.slug)!.map((q) => q.slug);
    const byCat = new Map<string, string[]>();
    for (const s of reqSlugs) {
      const cat = skillBySlug.get(s)!.category;
      byCat.set(cat, [...(byCat.get(cat) ?? []), s]);
    }
    return {
      role: r.slug,
      title: `${r.name} Roadmap`,
      description: 'Auto-generated from the role skill matrix and the global prerequisite graph (not yet hand-curated).',
      groups: [...byCat.entries()].map(([cat, nodes]) => ({ key: cat.toLowerCase().replace(/[^a-z]+/g, '-'), label: cat, nodes })),
      curated: false,
    };
  });

  for (const rm of [...ROADMAPS.map((r) => ({ ...r, curated: true })), ...autoSeeds]) {
    const rid = roleId.get(rm.role);
    if (!rid) throw new Error(`Roadmap references unknown role ${rm.role}`);
    const nodes: { key: string; group: string; spec: string | CustomNode }[] = rm.groups.flatMap((g) => g.nodes.map((n) => ({ key: typeof n === 'string' ? n : n.key, group: g.key, spec: n })));
    const keys = new Set(nodes.map((n) => n.key));
    const edges: Edge[] = [];
    const addEdge = (from: string, to: string) => { if (from !== to && !edges.some((e) => e.from === from && e.to === to)) edges.push({ from, to }); };
    // Nearest ancestors present in this roadmap, following the global skill prerequisite graph.
    const nearestPresent = (slug: string, seen = new Set<string>()): string[] => {
      const out: string[] = [];
      for (const p of skillBySlug.get(slug)?.prerequisites ?? []) {
        if (seen.has(p)) continue;
        seen.add(p);
        if (keys.has(p)) out.push(p);
        else out.push(...nearestPresent(p, seen));
      }
      return out;
    };
    for (const n of nodes) {
      if (typeof n.spec === 'string') {
        if (!skillBySlug.has(n.spec)) throw new Error(`Roadmap ${rm.role} references unknown skill ${n.spec}`);
        for (const p of nearestPresent(n.spec)) addEdge(p, n.key);
      } else {
        for (const a of n.spec.after) {
          if (!keys.has(a)) throw new Error(`Roadmap ${rm.role}: node ${n.key} depends on missing node ${a}`);
          addEdge(a, n.key);
        }
      }
    }
    const check = validateGraph([...keys], edges);
    if (!check.valid) throw new Error(`Roadmap ${rm.role} graph invalid: ${JSON.stringify(check)}`);
    const pos = layeredLayout([...keys], edges);

    const [existing] = await db.select().from(roadmaps).where(eq(roadmaps.roleId, rid));
    let roadmapId: number;
    if (existing) {
      roadmapId = existing.id;
      await db.update(roadmaps).set({ title: rm.title, description: rm.description, curated: rm.curated, version: existing.version + 1 }).where(eq(roadmaps.id, roadmapId));
      await db.delete(roadmapEdges).where(eq(roadmapEdges.roadmapId, roadmapId));
      await db.delete(roadmapNodes).where(eq(roadmapNodes.roadmapId, roadmapId));
    } else {
      [{ id: roadmapId }] = await db.insert(roadmaps).values({ roleId: rid, title: rm.title, description: rm.description, curated: rm.curated }).returning({ id: roadmaps.id });
    }
    await db.insert(roadmapNodes).values(nodes.map((n) => {
      const p = pos.get(n.key)!;
      if (typeof n.spec === 'string') {
        const s = skillBySlug.get(n.spec)!;
        return {
          roadmapId, key: n.key, type: 'skill' as const, label: s.name, groupKey: n.group, skillId: s.id, description: s.description,
          learningOutcome: s.learningOutcome, estimatedHours: s.baseHours, practiceTask: s.practiceTask, verificationMethod: VERIFY_SKILL,
          resourceIds: resourcesForSkill(s.id), x: p.x, y: p.y,
        };
      }
      const c = n.spec;
      return {
        roadmapId, key: c.key, type: c.type, label: c.label, groupKey: n.group, skillId: null, description: c.description,
        learningOutcome: c.outcome, estimatedHours: c.hours, practiceTask: c.practice, verificationMethod: c.verification,
        resourceIds: [], x: p.x, y: p.y,
      };
    }));
    if (edges.length) await db.insert(roadmapEdges).values(edges.map((e) => ({ roadmapId, fromKey: e.from, toKey: e.to })));
  }

  // Assessment item bank
  for (const it of ITEMS) {
    if (!skillId.has(it.skill)) throw new Error(`Assessment item ${it.key} references unknown skill ${it.skill}`);
    const values = {
      key: it.key, skillId: skillId.get(it.skill)!, type: it.type, difficulty: it.difficulty, prompt: it.prompt,
      options: it.options ?? null, correctIndex: it.correctIndex ?? null, explanation: it.explanation ?? '', rubric: it.rubric ?? null,
    };
    await db.insert(assessmentItems).values(values).onConflictDoUpdate({ target: assessmentItems.key, set: values });
  }

  // Job sources
  const sources = [
    { key: 'cert-trends', name: 'Cert Trends (postings that name a certification)', type: 'cert_trends' as const, baseUrl: ctx.config.jobs.certTrendsBaseUrl, isDemo: false, completeListing: false },
    { key: 'manual', name: 'Manual JD import', type: 'manual' as const, baseUrl: null, isDemo: false, completeListing: false },
    { key: 'demo', name: 'Demo postings (fictional)', type: 'demo' as const, baseUrl: null, isDemo: true, completeListing: true },
    ...ctx.config.jobs.greenhouseBoards.map((b) => ({ key: `greenhouse:${b}`, name: `Greenhouse board: ${b}`, type: 'greenhouse' as const, baseUrl: `https://boards-api.greenhouse.io/v1/boards/${b}/jobs?content=true`, isDemo: false, completeListing: true })),
    ...ctx.config.jobs.leverCompanies.map((c) => ({ key: `lever:${c}`, name: `Lever postings: ${c}`, type: 'lever' as const, baseUrl: `https://api.lever.co/v0/postings/${c}?mode=json`, isDemo: false, completeListing: true })),
  ];
  for (const s of sources) await db.insert(jobSources).values(s).onConflictDoUpdate({ target: jobSources.key, set: { name: s.name, baseUrl: s.baseUrl } });

  ctx.invalidateTaxonomy();

  if (opts.demoJobs !== false) {
    const [demo] = await db.select().from(jobSources).where(eq(jobSources.key, 'demo'));
    const now = ctx.now();
    await ingestJobs(ctx, demo, DEMO_JOBS.map((j) => ({
      externalId: j.externalId, title: j.title, company: j.company, description: j.description, location: j.location,
      country: j.country, market: j.market, workMode: j.workMode, url: null,
      postedAt: new Date(now.getTime() - j.postedDaysAgo * 86_400_000).toISOString().slice(0, 10), raw: { demo: true },
    })), { markMissing: false });
  }

  return { skills: skillRows.length, roles: roleRows.length };
}

/** Helper for tests: skill ids by slug. */
export async function skillIds(ctx: AppContext, slugs: string[]) {
  const rows = await ctx.db.select({ id: skills.id, slug: skills.slug }).from(skills).where(inArray(skills.slug, slugs));
  return new Map(rows.map((r) => [r.slug, r.id]));
}
