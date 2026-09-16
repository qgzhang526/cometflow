/**
 * 把 ISO 时间渲染成「3 分钟前 / 昨天 / 2026-09-14」这类相对时间。
 *
 * 分钟与小时向下取整：`Math.round` 会把「1 分 01 秒」说成 2 分钟前、把「59 分钟」说成 1 小时前。
 * 天数按**自然日**算，不按 24 小时的整数倍：「昨天」是日历上的昨天，
 * 23.6 小时前可能还是今天，而 36 小时前也可能只是昨天——用小时数除 24 四舍五入两种都会说错。
 *
 * `now` 可注入，便于按固定时刻验证边界（其余调用方只传 iso）。
 */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + ' 分钟前';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' 小时前';
  const days = calendarDaysBetween(new Date(then), now);
  if (days === 1) return '昨天';
  if (days === 2) return '前天';
  if (days < 30) return days + ' 天前';
  return new Date(then).toISOString().slice(0, 10);
}

/** 两个时刻相差几个自然日（按本地时区取当天 00:00 再相减，避开夏令时造成的 23/25 小时）。 */
function calendarDaysBetween(then: Date, now: Date): number {
  const startOfDay = (value: Date): number => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  return Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
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

/** 字节数：维护动作的预告与结果都用它显示，避免界面出现 `1048576` 这种读数。 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return (unit === 0 ? String(Math.round(value)) : value.toFixed(1)) + ' ' + units[unit];
}

/** 比率：域层用 `null` 表示「样本不足/无分母」，界面必须显示成 `—` 而不是 0%。 */
export function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : (value * 100).toFixed(1) + '%';
}
