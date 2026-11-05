# rig

Keeps a lane's lights on while nobody is in it: a heartbeat every minute, a status board, and
a morning digest of what ran overnight.

Use Node 22 or newer and the pnpm version pinned in `package.json`.

```sh
cp .env.example .env   # set LANE_MARKER
pnpm install
pnpm dev               # http://localhost:8787
```

Working on it with an agent: start at [AGENTS.md](AGENTS.md).

## Morning digest

- `/` links each recorded night to its digest with ok / retry / fail event counts.
- `/digest/2026-10-28` renders one row per job, including retry/failure warnings and bad-line counts.
- `/api/digest/2026-10-28` returns the same reader result as JSON, with the same job order.
- Missing or invalid nights return 404. Empty nights render "nothing ran".

Run `pnpm test` and `pnpm typecheck` before completing an issue. The files in `runs/` are
read-only fixtures; tests use temporary directories.
