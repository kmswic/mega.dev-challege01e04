import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
const firstAt = '2026-10-28T22:00:00+02:00';
const lastAt = '2026-10-28T23:00:00+02:00';
const events = [
  { job: 'zeta', owner: 'Zoe', at: firstAt, status: 'retry', error: 'connection lost' },
  { job: 'beta', owner: null, at: firstAt, status: 'fail', error: 'permission denied' },
  { job: 'Alpha', owner: 'Ada', at: firstAt, status: 'retry' },
  { job: 'zeta', owner: 'Zoe', at: '2026-10-28T22:10:00+02:00', status: 'retry' },
  { job: 'Alpha', owner: 'Ada', at: '2026-10-28T22:20:00+02:00', status: 'retry' },
  { job: 'zeta', owner: 'Zoe', at: '2026-10-28T22:30:00+02:00', status: 'retry' },
  { job: 'zeta', owner: 'Zoe', at: lastAt, status: 'ok' },
  { job: 'Alpha', owner: 'Ada', at: lastAt, status: 'ok' },
];
const expected: NightDigest = {
  night,
  rows: [
    { job: 'Alpha', owner: 'Ada', runs: 3, retries: 2, lastStatus: 'ok', lastError: null, firstAt, lastAt },
    { job: 'beta', owner: null, runs: 1, retries: 0, lastStatus: 'fail', lastError: 'permission denied', firstAt, lastAt: firstAt },
    { job: 'zeta', owner: 'Zoe', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'connection lost', firstAt, lastAt },
  ],
  badLines: 0,
  counts: { ok: 2, retry: 5, fail: 1 },
};

function jobRows(html: string) {
  return [...html.matchAll(/<tr\b[^>]*\bdata-job\s*=\s*(["'])(.*?)\1[^>]*>[\s\S]*?<\/tr>/gi)]
    .map((match) => ({ job: match[2], html: match[0] }));
}

function cells(html: string) {
  return [...html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((match) => match[1].replace(/<[^>]*>/g, '').trim());
}

function hasWarning(html: string) {
  return /\bclass\s*=\s*["'][^"']*\bwarn\b[^"']*["']/i.test(html);
}

describe('digest routes', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
    vi.stubEnv('LANE_MARKER', 'DIGEST-ROUTE-TEST');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(runsDir, { recursive: true, force: true });
  });

  function app() {
    return createApp({ adapter: 'shim', installed: firstAt, beatEverySeconds: 60, runsDir });
  }

  function writeNight(contents = events.map((event) => JSON.stringify(event)).join('\n') + '\n') {
    writeFileSync(join(runsDir, `${night}.jsonl`), contents);
  }

  it('renders the usual layout, banner and one sorted table row per job with every field', async () => {
    writeNight();
    const response = await app().request(`/digest/${night}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toMatch(/<header\b[^>]*>[\s\S]*DIGEST-ROUTE-TEST[\s\S]*<\/header>/i);
    expect(html).toContain('lane-07');
    expect(html).toMatch(/<style\b/);
    expect(html).toMatch(/<main\b/);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).toContain(night);
    expect(html.match(/<table\b/gi)).toHaveLength(1);
    const rows = jobRows(html);
    expect(rows.map((row) => row.job)).toEqual(expected.rows.map((row) => row.job));
    expect(html.match(/<td\b/gi)).toHaveLength(expected.rows.length * 8);
    for (const [index, row] of expected.rows.entries()) {
      const values = cells(rows[index].html);
      expect(values).toHaveLength(8);
      expect(values).toEqual(expect.arrayContaining([
        row.job, row.owner ?? '—', String(row.runs), String(row.retries),
        row.lastStatus, row.lastError ?? '—', row.firstAt, row.lastAt,
      ]));
      expect(values).not.toContain('');
    }
  });

  it('marks a failed job and three retries as warnings, but not two retries', async () => {
    writeNight();
    const response = await app().request(`/digest/${night}`);
    expect(response.status).toBe(200);
    const rows = jobRows(await response.text());
    expect(rows).toHaveLength(3);
    expect(hasWarning(rows[0].html)).toBe(false);
    expect(hasWarning(rows[1].html)).toBe(true);
    expect(hasWarning(rows[2].html)).toBe(true);
  });

  it('returns the full exact NightDigest JSON, including nulls, event counts and original offsets', async () => {
    writeNight();
    const response = await app().request(`/api/digest/${night}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual(expected);
  });

  it('keeps HTML and JSON jobs in the same case-sensitive sorted order', async () => {
    writeNight();
    const application = app();
    const htmlResponse = await application.request(`/digest/${night}`);
    const jsonResponse = await application.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const digest = await jsonResponse.json() as NightDigest;
    const jobs = jobRows(await htmlResponse.text()).map((row) => row.job);
    expect(jobs).toEqual(['Alpha', 'beta', 'zeta']);
    expect(jobs).toEqual(digest.rows.map((row) => row.job));
  });

  it.each(['/digest', '/api/digest'])('returns 404 for a missing file on %s', async (route) => {
    const response = await app().request(`${route}/${night}`);
    expect(response.status).toBe(404);
    if (route === '/api/digest') {
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual({ error: 'night not found' });
    }
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', ' \n\t\n\r\n  '],
  ])('renders %s nights as nothing ran and returns an empty digest', async (_label, contents) => {
    writeNight(contents);
    const application = app();
    const htmlResponse = await application.request(`/digest/${night}`);
    const jsonResponse = await application.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(html).toContain('nothing ran');
    expect(html).toContain('DIGEST-ROUTE-TEST');
    expect(jobRows(html)).toEqual([]);
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('skips malformed lines, displays their count, and preserves valid rows on both routes', async () => {
    writeNight(events.map((event) => JSON.stringify(event)).join('\n') + '\n{not json\n\n');
    const application = app();
    const htmlResponse = await application.request(`/digest/${night}`);
    const jsonResponse = await application.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(html.replace(/<[^>]*>/g, '')).toMatch(/bad lines:\s*1/);
    expect(jobRows(html).map((row) => row.job)).toEqual(['Alpha', 'beta', 'zeta']);
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({ ...expected, badLines: 1 });
  });

  it('escapes malicious job, owner and error content in HTML while preserving the original JSON', async () => {
    const job = 'evil"><script>alert(1)</script>';
    const owner = '<img src=x onerror=alert(2)>';
    const error = '<svg onload=alert(3)> & "failure"';
    writeNight(JSON.stringify({ job, owner, error, at: firstAt, status: 'fail' }) + '\n');
    const application = app();
    const htmlResponse = await application.request(`/digest/${night}`);
    const jsonResponse = await application.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(html).not.toMatch(/<(?:script|img|svg)\b/i);
    expect(html).not.toContain(job);
    expect(html).not.toContain(owner);
    expect(html).not.toContain(error);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;svg');
    const rows = jobRows(html);
    expect(rows).toHaveLength(1);
    expect(rows[0].job).toContain('&lt;script&gt;');
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      night,
      rows: [{ job, owner, runs: 1, retries: 0, lastStatus: 'fail', lastError: error, firstAt, lastAt: firstAt }],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 1 },
    });
  });

  it.each([
    'null',
    'undefined',
    '2026-02-30',
    '0000-01-01',
    '2026-10-28.jsonl',
    '..%2F2026-10-28',
    '%2e%2e%2fruns%2f2026-10-28',
    '..%5C2026-10-28',
  ])('rejects invalid or traversal night %s on both routes', async (invalidNight) => {
    // A real valid file must not become reachable through normalization or suffix stripping.
    writeNight();
    const application = app();
    const htmlResponse = await application.request(`/digest/${invalidNight}`);
    const jsonResponse = await application.request(`/api/digest/${invalidNight}`);
    expect(htmlResponse.status).toBe(404);
    expect(jsonResponse.status).toBe(404);
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    expect(await jsonResponse.json()).toEqual({ error: 'night not found' });
  });
});
