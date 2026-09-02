export interface ScheduleWindow {
  startMinutes: number;
  endMinutes: number;
}

export function parseScheduleTime(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/u.exec(value.trim());
  if (!match) throw new Error('Invalid schedule time: ' + value + ' (expected HH:MM)');
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error('Invalid schedule time: ' + value);
  }
  return hours * 60 + minutes;
}

export function parseScheduleWindow(start: string, end: string): ScheduleWindow {
  return { startMinutes: parseScheduleTime(start), endMinutes: parseScheduleTime(end) };
}
