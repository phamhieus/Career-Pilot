export const DAY = 86_400_000;

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function parseIsoDate(s: string): Date {
  return new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
}
export function addDays(s: string, days: number): string {
  return toIsoDate(new Date(parseIsoDate(s).getTime() + days * DAY));
}
export function daysBetween(a: string, b: string): number {
  return Math.round((parseIsoDate(b).getTime() - parseIsoDate(a).getTime()) / DAY);
}
export function todayIso(now = new Date()): string {
  return toIsoDate(now);
}
export function monthKey(d: Date | string): string {
  return (typeof d === 'string' ? d : d.toISOString()).slice(0, 7);
}
export function yearsBetween(start?: string | null, end?: string | null, now = new Date()): number {
  if (!start) return 0;
  const norm = (s: string) => (s.length === 7 ? `${s}-01` : s.length === 4 ? `${s}-01-01` : s);
  const s = new Date(norm(start));
  const e = end && !/present|now|hiện tại/i.test(end) ? new Date(norm(end)) : now;
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  return Math.max(0, (e.getTime() - s.getTime()) / (365.25 * DAY));
}
