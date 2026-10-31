import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { certificationSkills } from '../../seed/data/certifications.js';

export interface KnownCert { id: string; name: string; shortName: string; category: string; terms: string[]; skills: string[] }

export const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/cert-trends');

let cache: KnownCert[] | null = null;

/** Certification reference list (ids, names, aliases) from the Cert Trends dataset. */
export function knownCertifications(): KnownCert[] {
  if (cache) return cache;
  const raw = JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'certifications.json'), 'utf8')) as { id: string; name: string; shortName: string; code?: string; category: string; aliases?: string[] }[];
  cache = raw.map((c) => ({
    id: c.id,
    name: c.name,
    shortName: c.shortName,
    category: c.category,
    // Very short codes (e.g. "CC") are too ambiguous to match in free text.
    terms: [c.name, c.shortName, c.code ?? '', ...(c.aliases ?? [])].filter((t) => t && t.length >= 4),
    skills: certificationSkills(c.id, c.category),
  }));
  return cache;
}

export function certById(id: string) {
  return knownCertifications().find((c) => c.id === id);
}
