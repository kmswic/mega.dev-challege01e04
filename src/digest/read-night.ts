import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, ReadNight } from './types.js';

type Instant = { seconds: number; fraction: string };
type Event = {
  at: string;
  instant: Instant;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string | null;
};
type Job = {
  row: DigestRow;
  first: Instant;
  last: Instant;
  errorAt: Instant | null;
};

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function parseInstant(at: string): Instant | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|([+-])(\d{2})(?::?(\d{2}))?)$/.exec(at);
  if (!match || !validDate(match[1])) return null;
  const [, date, hour, minute, second = '0', fraction = '', zone, sign, offsetHour = '0', offsetMinute = '0'] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
    || Number(offsetHour) > 23 || Number(offsetMinute) > 59) return null;

  // setUTCFullYear avoids Date.UTC's special treatment of years 00–99.
  const [year, month, day] = date.split('-').map(Number);
  const time = new Date(0);
  time.setUTCFullYear(year, month - 1, day);
  time.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  const offset = zone === 'Z' ? 0
    : (Number(offsetHour) * 60 + Number(offsetMinute)) * (sign === '+' ? 1 : -1);
  return { seconds: time.getTime() / 1000 - offset * 60, fraction };
}

function compare(a: Instant, b: Instant): number {
  if (a.seconds !== b.seconds) return a.seconds - b.seconds;
  // Compare fractional seconds without rounding away sub-millisecond precision.
  const length = Math.max(a.fraction.length, b.fraction.length);
  const left = a.fraction.padEnd(length, '0');
  const right = b.fraction.padEnd(length, '0');
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseEvent(line: string): Event | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  const { at, job, status, owner, error } = event;
  if (typeof at !== 'string' || typeof job !== 'string' || job.length === 0
    || (status !== 'ok' && status !== 'retry' && status !== 'fail')
    || (owner !== null && typeof owner !== 'string')
    || (error !== undefined && error !== null && typeof error !== 'string')) return null;
  const instant = parseInstant(at);
  if (!instant) return null;
  return { at, instant, job, status, owner, error };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!validDate(night)) return null;
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const jobs = new Map<string, Job>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const event = parseEvent(line);
    if (!event) {
      badLines += 1;
      continue;
    }
    counts[event.status] += 1;
    const existing = jobs.get(event.job);
    if (!existing) {
      jobs.set(event.job, {
        row: {
          job: event.job, owner: event.owner, runs: 1,
          retries: event.status === 'retry' ? 1 : 0,
          lastStatus: event.status, lastError: event.error ?? null,
          firstAt: event.at, lastAt: event.at,
        },
        first: event.instant, last: event.instant,
        errorAt: typeof event.error === 'string' ? event.instant : null,
      });
      continue;
    }
    const { row } = existing;
    row.runs += 1;
    if (event.status === 'retry') row.retries += 1;
    if (compare(event.instant, existing.first) < 0) {
      existing.first = event.instant;
      row.firstAt = event.at;
    }
    if (compare(event.instant, existing.last) >= 0) {
      existing.last = event.instant;
      row.lastAt = event.at;
      row.lastStatus = event.status;
      row.owner = event.owner;
    }
    if (typeof event.error === 'string'
      && (existing.errorAt === null || compare(event.instant, existing.errorAt) >= 0)) {
      existing.errorAt = event.instant;
      row.lastError = event.error;
    }
  }
  const rows = [...jobs.values()].map(({ row }) => row);
  rows.sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { night, rows, badLines, counts };
};
