import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RigConfig } from '../src/config.js';
import { registerDigestJson } from '../src/digest/json-route.js';
import { readNight } from '../src/digest/read-night.js';
import type { NightDigest } from '../src/digest/types.js';

vi.mock('../src/digest/read-night.js', () => ({ readNight: vi.fn() }));

const config: RigConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '/unused/digest-json-runs',
};

function createApp() {
  const app = new Hono();
  registerDigestJson(app, config);
  return app;
}

describe('digest JSON route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the full digest unchanged, in reader order', async () => {
    const digest: NightDigest = {
      night: '2026-10-28',
      rows: [
        {
          job: 'Zebra', owner: null, runs: 4, retries: 3, lastStatus: 'fail',
          lastError: 'still failing', firstAt: '2026-10-28T22:00:00+01:00',
          lastAt: '2026-10-29T00:00:00+01:00',
        },
        {
          job: 'alpha', owner: 'rook', runs: 1, retries: 0, lastStatus: 'ok',
          lastError: null, firstAt: '2026-10-28T23:00:00+01:00',
          lastAt: '2026-10-28T23:00:00+01:00',
        },
      ],
      badLines: 1,
      counts: { ok: 1, retry: 3, fail: 1 },
    };
    vi.mocked(readNight).mockReturnValue(digest);

    const res = await createApp().request('/api/digest/2026-10-28');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual(digest);
    expect(readNight).toHaveBeenCalledExactlyOnceWith(config.runsDir, '2026-10-28');
  });

  it('returns an empty digest as JSON with status 200', async () => {
    const digest: NightDigest = {
      night: '2026-10-29', rows: [], badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    };
    vi.mocked(readNight).mockReturnValue(digest);

    const res = await createApp().request('/api/digest/2026-10-29');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(digest);
  });

  it.each(['2026-10-30', '2026-02-30', 'not-a-night', '..%2Fsecret'])(
    'returns JSON 404 when the reader rejects %s',
    async (night) => {
      vi.mocked(readNight).mockReturnValue(null);

      const res = await createApp().request(`/api/digest/${night}`);

      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({ error: 'night not found' });
      expect(readNight).toHaveBeenCalledExactlyOnceWith(config.runsDir, decodeURIComponent(night));
    },
  );

  it('leaves a missing night segment unmatched', async () => {
    const res = await createApp().request('/api/digest/');

    expect(res.status).toBe(404);
    expect(readNight).not.toHaveBeenCalled();
  });
});
