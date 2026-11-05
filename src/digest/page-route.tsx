import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { lane } from '../lane.js';
import { DigestView } from '../views/digest.js';
import { Layout } from '../views/layout.js';
import { readNight } from './read-night.js';

export function registerDigestPage(app: Hono, config: RigConfig): void {
  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    const digest = readNight(config.runsDir, night);

    return c.html(
      <Layout title={`digest · ${night}`} lane={lane()}>
        <DigestView night={night} digest={digest} />
      </Layout>,
      digest === null ? 404 : 200,
    );
  });
}
