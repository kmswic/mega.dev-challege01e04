/** The only accepted statuses in a run-log event. */
export type DigestStatus = 'ok' | 'retry' | 'fail';

/** Counts of accepted events, not counts of jobs or their final statuses. */
export type DigestCounts = {
  ok: number;
  retry: number;
  fail: number;
};

/** One job's accepted events, grouped by the exact job name. */
export type DigestRow = {
  job: string;
  /** Owner on the latest event, including an explicit null (display as —). */
  owner: string | null;
  /** All accepted events for this job, including retries and failures. */
  runs: number;
  /** Accepted events whose status is retry; a subset of runs. */
  retries: number;
  lastStatus: DigestStatus;
  /** Most recent supplied error string, even after recovery; null if none. */
  lastError: string | null;
  /** Earliest event's original timestamp, with its offset unchanged. */
  firstAt: string;
  /** Latest event's original timestamp, with its offset unchanged. */
  lastAt: string;
};

/** Shared result for the HTML page, JSON endpoint, and board counts. */
export type NightDigest = {
  /** The requested file's calendar date, not the dates of individual events. */
  night: string;
  /** One row per job, sorted by job using case-sensitive string comparison. */
  rows: DigestRow[];
  /** Nonblank lines rejected for invalid JSON or an invalid event shape. */
  badLines: number;
  /** Every accepted event contributes exactly once to one status count. */
  counts: DigestCounts;
};

/**
 * Synchronously read runsDir/<night>.jsonl.
 *
 * Implemented and exported as readNight in src/digest/read-night.ts; this file
 * exports only the contract, not a placeholder implementation.
 *
 * night must be exactly YYYY-MM-DD and a real Gregorian calendar date in years
 * 0001–9999. Reject invalid dates and path-like input with null before any file
 * access. Do not normalize dates, accept suffixes, or allow directory traversal.
 * A missing file (ENOENT) also returns null, allowing both routes to return 404.
 * Other filesystem errors propagate rather than masquerading as a missing night.
 *
 * An empty or whitespace-only file returns a NightDigest with empty rows,
 * badLines: 0 and zero counts, not null. Ignore blank lines, including a trailing
 * newline. Each other rejected line increments badLines once and is skipped;
 * malformed input never prevents accepted lines from contributing to the result.
 *
 * An accepted event is a JSON object with a nonempty string job, a valid ISO 8601
 * date-time at with an explicit UTC offset or Z, a DigestStatus status, and an
 * owner that is a string or null. error may be absent, null, or a string; other
 * types are invalid. Ignore extra fields. Never coerce invalid field values.
 * Missing owner is invalid; an explicit null owner must not drop the event.
 *
 * Order a job's events by their timestamp instants, not timestamp strings; break
 * ties by file order (later line wins). firstAt/lastAt are chronological bounds;
 * owner/lastStatus come from the latest event. lastError is the most recent
 * string error in that same order, or null if no event supplied one. Missing or
 * null errors do not erase an earlier error. Preserve original timestamp strings
 * for display: comparing instants must not normalize the returned offsets.
 * Events crossing midnight still belong to the requested file's night.
 *
 * counts.ok + counts.retry + counts.fail equals the sum of rows' runs;
 * counts.retry equals the sum of rows' retries. Rejected lines count in neither.
 * Sort rows with deterministic, locale-independent string comparison by job so
 * the HTML page and JSON endpoint always agree on order.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
