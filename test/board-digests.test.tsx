import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import { nightsOnDisk, readStatus } from '../src/status.js';

describe('board digests', () => {
  let directory: string;
  let config: RigConfig;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'rig-board-'));
    config = {
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir: directory,
    };
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function writeNight(night: string, lines: unknown[]) {
    writeFileSync(join(directory, `${night}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
  }

  it('links every night newest first and counts events, not final job statuses', async () => {
    const event = {
      at: '2026-10-28T01:00:00+01:00', job: 'recovered', owner: null,
    };
    writeNight('2026-10-28', [
      { ...event, status: 'fail' },
      { ...event, at: '2026-10-28T01:01:00+01:00', status: 'retry' },
      { ...event, at: '2026-10-28T01:02:00+01:00', status: 'retry' },
      { ...event, at: '2026-10-28T01:03:00+01:00', status: 'ok' },
      { ...event, job: 'other', status: 'ok' },
      { ...event, job: 'invalid', status: 'unknown' },
      null,
    ]);
    // Invalid JSON must not prevent the accepted events from reaching the board.
    writeFileSync(join(directory, '2026-10-28.jsonl'), '\nnot json\n', { flag: 'a' });
    writeNight('2026-10-29', [{ ...event, job: 'newer', status: 'fail' }]);

    const status = readStatus(config);
    expect(status.nights).toEqual(['2026-10-29', '2026-10-28']);
    expect(status.nightDigests.map(({ counts }) => counts)).toEqual([
      { ok: 0, retry: 0, fail: 1 },
      { ok: 2, retry: 2, fail: 1 },
    ]);
    expect(status.nightDigests[1].rows).toHaveLength(2);
    expect(status.nightDigests[1].badLines).toBe(3);

    const response = await createApp(config).request('/');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<a href="/digest/2026-10-29">2026-10-29</a> · 0 ok / 0 retry / 1 fail');
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a> · 2 ok / 2 retry / 1 fail');
    expect(html.indexOf('/digest/2026-10-29')).toBeLessThan(html.indexOf('/digest/2026-10-28'));
  });

  it('excludes invalid calendar nights, unrelated names and directories', async () => {
    for (const night of ['2026-02-29', '2026-02-30', '2026-13-01', '0000-01-01']) {
      writeNight(night, []);
    }
    writeNight('2024-02-29', []);
    writeFileSync(join(directory, 'notes.jsonl'), '');
    writeFileSync(join(directory, '2026-10-28.jsonl.bak'), '');
    mkdirSync(join(directory, '2026-10-30.jsonl'));

    expect(nightsOnDisk(directory)).toEqual(['2024-02-29']);
    const response = await createApp(config).request('/');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<a href="/digest/2024-02-29">2024-02-29</a> · 0 ok / 0 retry / 0 fail');
    expect(html.match(/href="\/digest\//g)).toHaveLength(1);
  });

  it('shows an empty board for an empty or missing runs directory', async () => {
    for (const runsDir of [directory, join(directory, 'missing')]) {
      const emptyConfig = { ...config, runsDir };
      expect(readStatus(emptyConfig).nights).toEqual([]);
      expect(readStatus(emptyConfig).nightDigests).toEqual([]);
      const response = await createApp(emptyConfig).request('/');
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('nothing in runs/');
    }
  });

  it('propagates filesystem errors other than missing paths', () => {
    const file = join(directory, 'not-a-directory');
    writeFileSync(file, '');
    expect(() => nightsOnDisk(file)).toThrow();
    expect(() => readStatus({ ...config, runsDir: file })).toThrow();
  });
});
