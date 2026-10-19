export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function pagination(page?: number, pageSize?: number): { skip: number; take: number; page: number; pageSize: number } {
  const safePage = Number.isFinite(page) && Number(page) > 0 ? Math.floor(Number(page)) : 1;
  const safeSize = Number.isFinite(pageSize) ? Math.floor(Number(pageSize)) : 25;
  const take = clamp(safeSize, 1, 100);
  return { skip: (safePage - 1) * take, take, page: safePage, pageSize: take };
}

export function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

export function safeJsonNumber(value: bigint | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  return Number(value);
}

export function timeBucket(date: Date, bucketMinutes: number): string {
  const bucketMs = bucketMinutes * 60_000;
  return new Date(Math.floor(date.getTime() / bucketMs) * bucketMs).toISOString();
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function periodForType(type: 'DAILY' | 'WEEKLY' | 'MONTHLY', now = new Date()): { start: Date; end: Date } {
  const end = new Date(now);
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  if (type === 'DAILY') {
    start.setUTCDate(start.getUTCDate() - 1);
  } else if (type === 'WEEKLY') {
    start.setUTCDate(start.getUTCDate() - 7);
    end.setUTCHours(0, 0, 0, 0);
  } else {
    start.setUTCDate(start.getUTCDate() - 30);
    end.setUTCHours(0, 0, 0, 0);
  }
  return { start, end };
}
