export function toDisplayDate(value: any, fallbackValue?: any): Date | null {
  const primary = normalizeDate(value);
  if (primary) return primary;
  return normalizeDate(fallbackValue);
}

function normalizeDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    return isValidDate(d) ? d : null;
  }
  if (value.seconds !== undefined && typeof value.seconds === 'number') {
    const d = new Date(value.seconds * 1000);
    return isValidDate(d) ? d : null;
  }
  const d = new Date(value);
  return isValidDate(d) ? d : null;
}

function isValidDate(d: Date): boolean {
  return d instanceof Date && !Number.isNaN(d.getTime()) && d.getTime() > 0;
}


const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * One key per instant, whatever way the timestamp is written: the server's
 * "2026-10-11T10:00:00.123456+00:00", a live update's "2026-10-11 10:00:00.123456+00",
 * or this device's "2026-10-11T10:00:00.123Z". Microseconds count. Values that are not
 * timestamps are compared as they are; empty values are ''.
 */
export function timeKey(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value).trim();
  const m = TIMESTAMP.exec(text);
  if (!m) return `raw:${text}`;
  const [, day, clock, fraction = '', zone = 'Z'] = m;
  let offset = zone.toUpperCase() === 'Z' ? 'Z' : zone.replace(':', '');
  if (offset !== 'Z' && offset.length === 3) offset += '00';
  if (offset !== 'Z') offset = `${offset.slice(0, 3)}:${offset.slice(3, 5)}`;
  const seconds = Date.parse(`${day}T${clock}${offset}`);
  if (!Number.isFinite(seconds)) return `raw:${text}`;
  return `${seconds / 1000}.${fraction.padEnd(6, '0').slice(0, 6)}`;
}

/** True when both values are the same instant (or both empty). */
export const sameInstant = (a: unknown, b: unknown): boolean => timeKey(a) === timeKey(b);
