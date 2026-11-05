import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { readNight } from './digest/read-night.js';
import type { NightDigest } from './digest/types.js';
import { lastBeat, type Beat } from './heartbeat.js';

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: string[];
  nightDigests: NightDigest[];
};

function readNightDigests(runsDir: string): NightDigest[] {
  let entries;
  try {
    entries = readdirSync(runsDir, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name))
    .map((entry) => entry.name.slice(0, 10))
    .sort()
    .reverse()
    .map((night) => readNight(runsDir, night))
    // The reader rejects invalid calendar dates and files removed since listing.
    .filter((digest): digest is NightDigest => digest !== null);
}

// Readable calendar nights on disk, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  return readNightDigests(runsDir).map((digest) => digest.night);
}

export function readStatus(config: RigConfig): Status {
  const nightDigests = readNightDigests(config.runsDir);
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights: nightDigests.map((digest) => digest.night),
    nightDigests,
  };
}
