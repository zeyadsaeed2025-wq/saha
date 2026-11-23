/** Convert a local wall-clock time in an IANA timezone to a UTC ISO string. */
export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  let offsetMs = timezoneOffset(utcGuess, timeZone);
  let result = new Date(utcGuess.getTime() - offsetMs);
  offsetMs = timezoneOffset(result, timeZone);
  result = new Date(utcGuess.getTime() - offsetMs);
  return result.toISOString();
}

export function timezoneOffset(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(at).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]),
  );
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    - Math.floor(at.getTime() / 1000) * 1000;
}

export const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const dayOfWeek = (date: string): number =>
  new Date(`${date}T00:00:00.000Z`).getUTCDay();

export const roundMinutes = (seconds: number): number => Math.round(seconds / 60);

export const formatDuration = (seconds: number): string => {
  const mins = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};
