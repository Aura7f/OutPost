import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';

export function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : parseISO(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return format(date, 'dd MMM yyyy, HH:mm');
}

export function shortDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return format(date, 'dd MMM');
}

export function dayLabel(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return format(date, 'dd MMM yyyy');
}

export function timeLabel(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return format(date, 'HH:mm:ss');
}

export function relative(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

export function number(value: number | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  return new Intl.NumberFormat('en-US').format(value);
}

export function compactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function latency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

export function durationMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`;
}

export function durationBetween(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
): string {
  const from = toDate(start);
  const to = toDate(end) ?? new Date();
  if (!from) return '—';
  return durationMs(to.getTime() - from.getTime());
}

export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / Math.pow(1024, exponent);
  return `${size.toFixed(size >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function initials(name: string | null | undefined, email?: string): string {
  const source = name?.trim() || email?.split('@')[0] || '?';
  return source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function relativeWindow(start: string, end: string): string {
  return `${dayLabel(start)} → ${dayLabel(end)}`;
}

export function isoDate(date: Date): string {
  return format(date, 'yyyy-LL-dd');
}

export function todayIso(): string {
  return isoDate(new Date());
}

export function daysAgoIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoDate(date);
}
