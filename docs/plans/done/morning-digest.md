---
plan: morning-digest
status: done
owner: rook
opened: 2026-10-29
---

# Morning digest

The night's run log is a JSONL file nobody reads. By breakfast someone has to know what ran,
what retried, what failed, and whose it was, without opening `runs/`. rig already serves the
status board; the digest is one more page on it.

Out of scope: notifications, history across nights, auth (rig only listens on localhost).

## 1. Run log reader

Read `runs/<night>.jsonl` into one row per job: job, owner, runs, retries, last status, last
error, first and last time. One JSON object per line (`at`, `job`, `status`: `ok | retry | fail`,
`owner`, optional `error`).

- A line that doesn't parse is counted, never thrown. The night still renders.
- `owner` can be `null`. Keep the row; show the owner as `—`.
- Lives in `src/digest/`. Commit `src/digest/types.ts` first (the `DigestRow` type and the
  `readNight(runsDir, night)` signature), so every part of section 2 can start against it.

Done when: reader tests pass on `runs/2026-10-28.jsonl` (5 jobs, 1 bad line).

## 2. Digest page

Four small parts. Each needs only `src/digest/types.ts` from section 1, so once that is in they
can go to four workers at once. Small, well-specified work: a cheaper model is fine here.

### 2a. Page

`GET /digest/:night` renders the rows with the usual layout: one table, sorted by job, retries of
3 or more and any `fail` marked. A night with no file returns 404; an empty file renders
"nothing ran".

Done when: `/digest/2026-10-28` renders locally.

### 2b. JSON

`GET /api/digest/:night` returns the same rows as JSON. Agents read this one; the page and the
JSON must never disagree (ADR 0001).

Done when: the JSON for 2026-10-28 has the same jobs, in the same order, as the page.

### 2c. Board link

The status board links each night on disk to its digest, with its ok / retry / fail counts beside
it.

Done when: both nights on disk link to a digest that renders.

### 2d. Route tests

Route tests for 2a and 2b: 200, 404 for a night with no file, the empty night, a night with a bad
line. Use a temp runs dir; `runs/` is read-only.

Done when: `pnpm test` is green with the new tests.

## 3. Preview for review

The reviewer reads the page from a copy, not from the lane. Run rig and save `/digest/2026-10-28` as
one HTML file, lane banner included (a command, not a browser's "save as"; the page is
self-contained, ADR 0001). Put it on your own public host, one where you can upload over it later (any bucket
or static host, ADR 0003), so it opens from a public HTTPS link. Send the reviewer the link and the
issues for this plan.

Done when: the preview link is sent to the reviewer.

## 4. Clean up

The preview carries this lane's marker on a public link (ADR 0003). Take the marker off: save the
page again with `LANE_MARKER` unset (the banner reads "no marker set") and upload it over the same
link. Move this plan to `docs/plans/done/` with its issue list.

Done when: the preview link no longer shows the lane marker.

## Completion

### Issues

1. [Digest types: publish the shared reader contract](https://github.com/kmswic/mega.dev-challege01e04/issues/1)
2. [Run log reader: aggregate overnight jobs safely](https://github.com/kmswic/mega.dev-challege01e04/issues/2)
3. [Digest page: render GET /digest/:night](https://github.com/kmswic/mega.dev-challege01e04/issues/3)
4. [Digest JSON: expose GET /api/digest/:night](https://github.com/kmswic/mega.dev-challege01e04/issues/4)
5. [Status board: link recorded nights and show status counts](https://github.com/kmswic/mega.dev-challege01e04/issues/5)
6. [Digest route tests: cover HTML and JSON edge cases](https://github.com/kmswic/mega.dev-challege01e04/issues/6)
7. [Review preview: publish a self-contained HTML copy](https://github.com/kmswic/mega.dev-challege01e04/issues/7)
8. [Preview cleanup: remove marker after review and archive plan](https://github.com/kmswic/mega.dev-challege01e04/issues/8)

Issue URLs and titles come from the private course record `s01e04-log/issues.json`.

### Review and public cleanup

- The initial preview was published by [run 42114211127](https://github.com/kmswic/mega.dev-challege01e04/actions/runs/42114211127)
  at <https://kmswic.github.io/mega.dev-challege01e04/>.
- The course confirmed that the reviewer had seen the preview, not merely received
  its link (private course record `s01e04-log/claim-4.json`, response message).
  The human then explicitly approved cleanup; issue #7 is closed.
- The cleanup worker's workflow dispatch was refused with HTTP 403. The parent
  executed the approved clean dispatch and observed successful deployment in
  [run 42242796668](https://github.com/kmswic/mega.dev-challege01e04/actions/runs/42242796668).
  The workflow exported with `LANE_MARKER` unset and replaced the same public URL.
- The parent's public verification returned HTTP 200, five jobs, the banner
  `no marker set`, no original marker, and no client scripts (private course
  record `s01e04-log/cleanup-verification.json`).
- After that verification, the parent removed only the initial marker-bearing
  artifact `13455755576` and the repository Actions secret `LANE_MARKER`.
  Both commands exited 0; the initial run's artifact list was empty and the
  repository secret list was empty afterward (private command record
  `s01e04-log/commands.jsonl`). These actions do not revoke downloaded copies
  or third-party caches.

### Local cleanup and acceptance

- Using Node 22, the cleanup worker exported the main repository's ignored
  `var/preview/index.html` with `--clean`, overwriting the marked copy. Private
  assertions confirmed five jobs, the unset-marker banner, no original marker,
  and no client scripts, without printing HTML or the marker.
- The worker removed only `var/review-check/index.html` and the `LANE_MARKER`
  assignment in the main repository's ignored `.env`; all other lines and
  environment values, including `LANE_ID` and `PORT`, were preserved.
  Private course proof files and the parent's clean verification HTML were
  left unchanged.
- All 72 tests in six files passed, and `pnpm typecheck` passed, using Node
  22.23.4 and existing dependencies. Both supplied `runs/` fixtures were
  verified byte-for-byte unchanged against HEAD. Command evidence is in the
  private course record `s01e04-log/commands.jsonl`.
- The original plan is archived here with all eight issue links. At the cleanup
  worker's handoff, issue #8 remained open for parent verification and integration;
  the parent handles issue closure and final course resubmission separately.
