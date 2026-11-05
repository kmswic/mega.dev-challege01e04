import { describe, expect, it } from 'vitest';
import type { DigestRow, NightDigest } from '../src/digest/types.js';
import { DigestView } from '../src/views/digest.js';

const night = '2026-10-28';
const row: DigestRow = {
  job: 'archive',
  owner: 'night crew',
  runs: 5,
  retries: 3,
  lastStatus: 'fail',
  lastError: 'disk unavailable',
  firstAt: '2026-10-28T22:00:00+02:00',
  lastAt: '2026-10-29T01:15:00+01:00',
};

function digest(rows: DigestRow[], badLines = 0): NightDigest {
  return { night, rows, badLines, counts: { ok: 0, retry: 0, fail: 0 } };
}

describe('digest view', () => {
  it('renders every field, original timestamp offsets, and one row per job in reader order', () => {
    const html = <DigestView night={night} digest={digest([
      row,
      { ...row, job: 'backup', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null },
    ])} />;
    const text = html.toString();

    for (const heading of ['job', 'owner', 'runs', 'retries', 'last status', 'last error', 'first at', 'last at']) {
      expect(text).toContain(`<th scope="col">${heading}</th>`);
    }
    for (const value of [night, row.job, row.owner, row.lastError, row.firstAt, row.lastAt]) {
      expect(text).toContain(value);
    }
    expect(text).toContain('<td>5</td>');
    expect(text).toContain('<td>1</td>');
    expect(text).toContain('<td>0</td>');
    expect(text).toContain('<td>ok</td>');
    expect(text.match(/data-job=/g)).toHaveLength(2);
    expect(text.match(/<td>—<\/td>/g)).toHaveLength(2);
    expect(text.indexOf('data-job="archive"')).toBeLessThan(text.indexOf('data-job="backup"'));
    expect(text).toContain(`<time dateTime="${row.firstAt}">${row.firstAt}</time>`);
    expect(text).toContain(`<time dateTime="${row.lastAt}">${row.lastAt}</time>`);
  });

  it('marks three or more retries and final failure with emphasis, not color alone', () => {
    const text = (<DigestView night={night} digest={digest([
      row,
      { ...row, job: 'recovered', retries: 4, lastStatus: 'ok' },
      { ...row, job: 'single-fail', retries: 0 },
      { ...row, job: 'low-retry', retries: 2, lastStatus: 'retry' },
    ])} />).toString();

    expect(text).toContain('<strong class="warn">3 (high retries)</strong>');
    expect(text).toContain('<strong class="warn">4 (high retries)</strong>');
    expect(text.match(/<strong class="warn">fail<\/strong>/g)).toHaveLength(2);
    expect(text).toContain('<td>2</td>');
    expect(text).toContain('<td>retry</td>');
    expect(text).not.toContain('<strong class="warn">2');
    expect(text).not.toContain('<strong class="warn">ok');
  });

  it('escapes log text and row attributes without truncating errors or adding scripts or styles', () => {
    const error = `<script>alert("unsafe")</script> & ${'full error detail '.repeat(100)}`;
    const text = (<DigestView night={'<night>'} digest={digest([
      { ...row, job: 'job" onclick="unsafe', owner: '<owner> & crew', lastError: error },
    ])} />).toString();

    expect(text).toContain('&lt;night&gt;');
    expect(text).toContain('data-job="job&quot; onclick=&quot;unsafe"');
    expect(text).toContain('&lt;owner&gt; &amp; crew');
    expect(text).toContain('&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt; &amp; ');
    expect(text).toContain('full error detail '.repeat(100));
    expect(text).not.toMatch(/<script|<style| onclick="/);
  });

  it('renders an empty night as nothing ran without a table', () => {
    const text = (<DigestView night={night} digest={digest([])} />).toString();

    expect(text).toContain('nothing ran');
    expect(text).not.toContain('<table');
    expect(text).not.toContain('bad lines:');
  });

  it('shows rejected line counts alongside valid jobs or an all-malformed empty state', () => {
    const partial = (<DigestView night={night} digest={digest([row], 1)} />).toString();
    const malformed = (<DigestView night={night} digest={digest([], 2)} />).toString();

    expect(partial).toContain('bad lines: 1');
    expect(partial).toContain('data-job="archive"');
    expect(malformed).toContain('bad lines: 2');
    expect(malformed).toContain('nothing ran');
  });

  it('renders a human-readable missing state and escapes the requested night', () => {
    const text = (<DigestView night={'<missing>'} digest={null} />).toString();

    expect(text).toContain('<h1>digest · &lt;missing&gt;</h1>');
    expect(text).toContain('No run log found for &lt;missing&gt;.');
    expect(text).not.toContain('nothing ran');
    expect(text).not.toContain('<table');
  });
});
