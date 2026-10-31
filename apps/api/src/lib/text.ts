import { createHash } from 'node:crypto';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function normalizeText(s: string): string {
  return s
    .replace(/[đĐ]/g, 'd')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+#./ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip HTML tags/entities and control characters from untrusted text. */
export function cleanUntrustedText(input: string, maxLen = 20000): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|div|h\d|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLen);
}

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-term match on normalized text that also works for terms like "c#", "node.js", "ci/cd". */
export function containsTerm(haystackNormalized: string, term: string): boolean {
  const t = normalizeText(term);
  if (!t) return false;
  const re = new RegExp(`(^|[^a-z0-9+#])${escapeRegex(t)}($|[^a-z0-9+#])`);
  return re.test(haystackNormalized);
}

export function canonicalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|source$|gh_src|lever-)/i.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
export const uid = (prefix = 'b') => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
