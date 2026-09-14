/** 把 ISO 时间渲染成「3 分钟前 / 昨天 / 2026-09-14」这类相对时间。 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + ' 分钟前';
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + ' 小时前';
  const days = Math.round(hours / 24);
  if (days === 1) return '昨天';
  if (days < 30) return days + ' 天前';
  return new Date(then).toISOString().slice(0, 10);
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return '—';
  return hash.slice(0, 12);
}

export function minutesToClock(minutes: number | undefined): string {
  if (minutes === undefined || Number.isNaN(minutes)) return '';
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

export function clockToMinutes(clock: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/u.exec(clock.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return hour * 60 + minute;
}

export function jsonPreview(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
