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
