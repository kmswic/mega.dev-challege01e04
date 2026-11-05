import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const night = '2026-10-28';
const directories: string[] = [];

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'rig-digest-reader-'));
  directories.push(path);
  return path;
}

function readLines(lines: unknown[]) {
  const path = directory();
  writeFileSync(join(path, `${night}.jsonl`), lines.map(line => JSON.stringify(line)).join('\n'));
  return readNight(path, night)!;
}

function event(fields: Record<string, unknown> = {}) {
  return { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook', ...fields };
}

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('readNight', () => {
  it('reads the real fixture: five jobs, one bad line, and counts every accepted event', () => {
    const digest = readNight('runs', night)!;
    expect(digest.night).toBe(night);
    expect(digest.badLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest.rows).toEqual([
      { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
      { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
        firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
      { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
        firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
      { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
        firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
      { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' },
    ]);
    expect(digest.rows.reduce((sum, row) => sum + row.runs, 0)).toBe(15);
    expect(digest.rows.reduce((sum, row) => sum + row.retries, 0)).toBe(digest.counts.retry);
  });

  it('distinguishes missing nights from empty and whitespace-only files', () => {
    const path = directory();
    expect(readNight(path, night)).toBeNull();
    for (const contents of ['', ' \r\n\t\n\r\n']) {
      writeFileSync(join(path, `${night}.jsonl`), contents);
      expect(readNight(path, night)).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    }
  });

  it('propagates filesystem errors other than ENOENT', () => {
    const path = directory();
    mkdirSync(join(path, `${night}.jsonl`));
    expect(() => readNight(path, night)).toThrow();
  });

  it('keeps explicit null owners, null errors, empty string errors, and extra fields', () => {
    const digest = readLines([
      event({ owner: null, error: null, extra: true }),
      event({ job: 'empty-error', error: '' }),
    ]);
    expect(digest.badLines).toBe(0);
    expect(digest.rows[1]).toMatchObject({ job: 'job', owner: null, lastError: null });
    expect(digest.rows[0].lastError).toBe('');
  });

  it('orders instants, preserves offsets, and retains the chronological last string error after recovery', () => {
    const digest = readLines([
      event({ at: '2026-10-29T00:10:00+02:00', status: 'retry', error: 'latest error' }),
      event({ at: '2026-10-28T22:30:00Z', owner: null, error: null }),
      event({ at: '2026-10-28T23:00:00+01:00', status: 'fail', owner: 'old', error: 'old error' }),
    ]);
    expect(digest.rows[0]).toEqual({
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'latest error',
      firstAt: '2026-10-28T23:00:00+01:00', lastAt: '2026-10-28T22:30:00Z',
    });
    expect(digest.counts).toEqual({ ok: 1, retry: 1, fail: 1 });
  });

  it('breaks equal instants by file order, including errors and original timestamp representations', () => {
    const digest = readLines([
      event({ at: '2026-10-28T23:00:00+01:00', status: 'retry', error: 'first' }),
      event({ at: '2026-10-28T22:00:00.000Z', status: 'fail', error: 'second' }),
      event({ at: '2026-10-28T17:00:00-05:00', owner: null }),
    ]);
    expect(digest.rows[0]).toMatchObject({
      firstAt: '2026-10-28T23:00:00+01:00', lastAt: '2026-10-28T17:00:00-05:00',
      owner: null, lastStatus: 'ok', lastError: 'second', runs: 3, retries: 1,
    });
  });

  it('does not round away fractional timestamp chronology', () => {
    const digest = readLines([
      event({ at: '2026-10-28T22:00:00.0002Z', status: 'fail', error: 'newer' }),
      event({ at: '2026-10-28T22:00:00.00010Z', error: 'older' }),
    ]);
    expect(digest.rows[0]).toMatchObject({ lastStatus: 'fail', lastError: 'newer',
      firstAt: '2026-10-28T22:00:00.00010Z', lastAt: '2026-10-28T22:00:00.0002Z' });
  });

  it('compares years below 100 without treating them as twentieth-century dates', () => {
    const digest = readLines([
      event({ at: '0100-01-01T00:00:00Z', owner: 'new' }),
      event({ at: '0099-12-31T23:59:59Z', owner: 'old' }),
    ]);
    expect(digest.rows[0]).toMatchObject({ owner: 'new',
      firstAt: '0099-12-31T23:59:59Z', lastAt: '0100-01-01T00:00:00Z' });
  });

  it.each(['2026-10-28T22:00Z', '2026-10-28T23:00:00+01',
    '2026-10-28T23:00:00+0100', '2026-10-28T17:00:00-05:00'])('accepts explicit ISO offset form %s', at => {
    const digest = readLines([event({ at }), event({ at: '2026-10-28T22:00:00Z', owner: null })]);
    expect(digest.badLines).toBe(0);
    expect(digest.rows[0]).toMatchObject({ firstAt: at, lastAt: '2026-10-28T22:00:00Z', owner: null });
  });

  it('groups prototype-like and malicious names safely and sorts case-sensitively without locale rules', () => {
    const names = ['toString', '__proto__', 'constructor', '<script>alert(1)</script>', 'a', 'Z', 'A', 'ä'];
    const digest = readLines([...names.map(job => event({ job })), event({ job: '__proto__', status: 'retry' })]);
    expect(digest.rows.map(row => row.job)).toEqual([
      '<script>alert(1)</script>', 'A', 'Z', '__proto__', 'a', 'constructor', 'toString', 'ä',
    ]);
    expect(digest.rows.find(row => row.job === '__proto__')).toMatchObject({ runs: 2, retries: 1 });
    expect(digest.counts).toEqual({ ok: 8, retry: 1, fail: 0 });
  });

  it.each(['../2026-10-28', '/2026-10-28', '2026-10-28/..', '2026-10-28.jsonl', '2026-10-28\n',
    '2026-10-28\0', '2026-1-01', '0000-01-01', '10000-01-01', '2026-00-01', '2026-13-01',
    '2026-01-00', '2026-04-31', '2026-02-29', '1900-02-29', '2026-01-32'])('rejects invalid night %j before file access', invalid => {
    // A non-directory would throw ENOTDIR if a file read were attempted.
    const path = join(directory(), 'not-a-directory');
    writeFileSync(path, '');
    expect(readNight(path, invalid)).toBeNull();
  });

  it.each(['0001-01-01', '0099-12-31', '2000-02-29', '2024-02-29', '9999-12-31'])('accepts real calendar date %s', date => {
    const path = directory();
    writeFileSync(join(path, `${date}.jsonl`), JSON.stringify(event({ at: `${date}T00:00:00Z` })));
    expect(readNight(path, date)?.rows[0].firstAt).toBe(`${date}T00:00:00Z`);
  });

  it('counts malformed schemas and JSON once each, ignores blank lines, and continues reading', () => {
    const invalid = [null, [], 42, true, 'event', {}, event({ job: '' }), event({ job: 1 }),
      event({ status: 'OK' }), event({ status: null }), event({ owner: undefined }), event({ owner: 0 }),
      event({ owner: {} }), event({ error: false }), event({ error: [] }), event({ at: null }),
      event({ at: '2026-02-30T12:00:00Z' }), event({ at: '2026-10-28T24:00:01Z' }),
      event({ at: '2026-10-28T12:60:00Z' }), event({ at: '2026-10-28T12:00:60Z' }),
      event({ at: '2026-10-28T12:00:00+24:00' }), event({ at: '2026-10-28T12:00:00+01:60' }),
      event({ at: '2026-10-28T12:00:00' }), event({ at: '2026-10-28' }),
      event({ at: '2026-10-28T12:00:00Zjunk' }), event({ at: '2026-10-28T12:00:00Z\n' })];
    const path = directory();
    writeFileSync(join(path, `${night}.jsonl`), [JSON.stringify(event()), '', ' \t', '{broken',
      ...invalid.map(value => JSON.stringify(value)), JSON.stringify(event({ status: 'retry' })), ''].join('\r\n'));
    const digest = readNight(path, night)!;
    expect(digest.badLines).toBe(invalid.length + 1);
    expect(digest.counts).toEqual({ ok: 1, retry: 1, fail: 0 });
    expect(digest.rows[0]).toMatchObject({ runs: 2, retries: 1, lastStatus: 'retry' });
  });
});
