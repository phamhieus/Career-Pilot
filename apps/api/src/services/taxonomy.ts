import type { Db } from '../db/client.js';
import { careerRoles, skills } from '../db/schema.js';
import { containsTerm, normalizeText } from '../lib/text.js';

export interface TaxonomySkill { id: number; slug: string; name: string; category: string; terms: string[]; prerequisites: string[]; baseHours: number }
export interface TaxonomyRole { id: number; slug: string; name: string; titleKeywords: string[] }

/** In-memory view of the skill taxonomy and role titles, used for deterministic text matching. */
export class Taxonomy {
  readonly bySlug = new Map<string, TaxonomySkill>();
  readonly byId = new Map<number, TaxonomySkill>();

  constructor(public skills: TaxonomySkill[], public roles: TaxonomyRole[]) {
    for (const s of skills) {
      this.bySlug.set(s.slug, s);
      this.byId.set(s.id, s);
    }
  }

  static async load(db: Db): Promise<Taxonomy> {
    const rows = await db.select().from(skills);
    const roleRows = await db.select({ id: careerRoles.id, slug: careerRoles.slug, name: careerRoles.name, titleKeywords: careerRoles.titleKeywords }).from(careerRoles);
    return new Taxonomy(
      rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        category: r.category,
        prerequisites: r.prerequisites,
        baseHours: r.baseHours,
        // Names shorter than 3 chars (e.g. "Go") are too ambiguous; explicit aliases cover them.
        terms: [...new Set([r.name, ...r.aliases].filter((t) => normalizeText(t).length >= 2 && !(t === r.name && t.length < 3)))],
      })),
      roleRows,
    );
  }

  /** Skills mentioned in free text, ordered by first appearance. */
  findSkills(text: string): string[] {
    const norm = ` ${normalizeText(text)} `;
    const hits: { slug: string; pos: number }[] = [];
    for (const s of this.skills) {
      let best = -1;
      for (const term of s.terms) {
        if (!containsTerm(norm, term)) continue;
        const pos = norm.indexOf(normalizeText(term));
        if (best === -1 || pos < best) best = pos;
      }
      if (best >= 0) hits.push({ slug: s.slug, pos: best });
    }
    return hits.sort((a, b) => a.pos - b.pos).map((h) => h.slug);
  }

  /** Map free-form skill names (e.g. from AI extraction) to taxonomy slugs; unmatched names are returned as unknown. */
  mapNames(names: string[]): { slugs: string[]; unknown: string[] } {
    const slugs: string[] = [];
    const unknown: string[] = [];
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      const direct = this.bySlug.get(normalizeText(name).replace(/ /g, '-'));
      const found = direct ? [direct.slug] : this.findSkills(name);
      if (found.length) {
        for (const f of found.slice(0, 2)) if (!slugs.includes(f)) slugs.push(f);
      } else if (!unknown.includes(name)) unknown.push(name);
    }
    return { slugs, unknown };
  }

  /** Best matching career role for a job title (longest keyword wins). */
  normalizeRole(title: string): { roleId: number | null; slug: string | null; keyword: string | null } {
    const norm = ` ${normalizeText(title)} `;
    let best: { role: TaxonomyRole; kw: string } | null = null;
    for (const role of this.roles) {
      for (const kw of role.titleKeywords) {
        const k = normalizeText(kw);
        if (!k) continue;
        const matched = kw.startsWith(' ') ? norm.includes(` ${k} `) : containsTerm(norm, k);
        if (matched && (!best || k.length > normalizeText(best.kw).length)) best = { role, kw };
      }
    }
    return best ? { roleId: best.role.id, slug: best.role.slug, keyword: best.kw.trim() } : { roleId: null, slug: null, keyword: null };
  }
}
