# Manual digest preview

This implements the hosting path for `plan.md` sections 3 and 4 (ADR 0001 and
0003). It does not publish on push, commit HTML, or create a preview branch.
GitHub Pages receives an Actions artifact containing only `index.html`, fetched
from the running rig's `GET /digest/2026-10-28`. The page uses inline CSS and no
client JavaScript. Never paste the page or marker into issues, logs, or chat.

## Before the first deployment: approval required

Wait for the digest workers to integrate and all tests and typechecks to pass.
Ask the human to approve **the initial public deployment** before changing GitHub
settings, adding a secret, pushing workflow changes, or dispatching the workflow.
Explain that the lane banner and marker will be publicly readable at the repo's
Pages URL until review finishes; a later clean deployment replaces that page but
cannot revoke copies already downloaded. State the repo, audience, proposed
changes, and cleanup method. Do not treat approval of the issue plan as approval
to publish the marker. If one approval covers a named set of these actions,
stay within that scope.

After that approval:

1. Put the reviewed workflow on the repository's default branch. Configure
   **Settings → Pages → Build and deployment → Source: GitHub Actions**. No
   `gh-pages` branch is needed. The workflow never commits generated HTML.
2. Set `LANE_MARKER` as an Actions secret through the approved secure channel.
    Do not hard-code its value in the workflow, an input, HTML, base64, or a command
   in shell history. Do not commit `.env`. The initial export fails without a
   nonempty marker. Use Node 22 and the exact pnpm 10 version pinned by
   `packageManager`; installation uses `pnpm-lock.yaml` with `--frozen-lockfile`.
3. Consider required reviewers on the `github-pages` environment where the
   repository's plan supports them. These are an additional gate, not a
   substitute for asking the human. Dispatch **Manual digest preview** with
   `clean: false` on the approved ref. Only `workflow_dispatch` can trigger it.
4. The workflow checks tests and types before exporting, then configures Pages,
   uploads the artifact with one-day retention, and deploys it. It has only
   `contents: read`, `pages: write`, and `id-token: write` permissions. The
   `pages` concurrency group does not cancel an in-progress deployment; wait for
   each run to complete before dispatching another. Do not queue initial and
   cleanup runs together: GitHub concurrency does not guarantee queue order.
5. Open the public HTTPS URL from the deployment/environment output and confirm
   the digest and banner render. Do not print the HTML while checking it.
   Send the reviewer **the URL and this plan's issue links**, not an attachment.
   Sending that message is also an outside action: obtain approval for its
   recipient and content first. Issue #7 stays open until that approved message
    has actually been sent and the course confirms the reviewer has looked.
    Delivery acknowledgement is not review completion. Record URLs/run IDs only,
    never marker values.

## Local export (does not deploy)

With existing installed dependencies and Node 22 or newer, from the repo root:

```sh
node scripts/export-preview.mjs --output var/preview/index.html
```

The initial export loads `.env` if present (or `--env-file path` when explicitly
selected). Existing environment values take precedence. It requires a nonempty
`LANE_MARKER`. Output stays under the already ignored `var/` directory; never
force-add it. The exporter uses the current Node executable to start installed
`node_modules/tsx/dist/cli.mjs src/server.ts` directly, with no `--env-file`
argument, a temporary port, bounded readiness retries, and a timed HTTP fetch.
It fetches over loopback, checks HTTP 200 and static HTML, and always terminates
the server process group, including on failure or interruption. Server output
and response content are not logged. The server explicitly binds to
`127.0.0.1`; run this on a trusted local machine or the isolated Actions runner.

For a local clean copy:

```sh
node scripts/export-preview.mjs --clean --output var/preview/index.html
```

`--clean` skips `.env` loading entirely and deletes `LANE_MARKER` from the child
environment, even when inherited from a shell or secret. It cannot be combined
with `--env-file`. The output must show `no marker set`. A local export does not
replace a public deployment.

## After review: a separate approval is required

**Wait for the review to be in.** Then ask the human to approve replacing the
public page with the clean copy, at the same Pages URL. Explain that this
removes the public marker and that restoring it would require another approved
deployment. Do not dispatch cleanup under the initial deployment approval.

After cleanup approval:

1. Dispatch the same workflow and approved ref with **`clean: true`**. Do not
   unset a secret manually as a workaround: this branch of the workflow does
   not inject it, and the exporter explicitly removes any inherited marker and
   refuses to load `.env`. This works even if the Actions secret still exists.
2. Wait for successful deployment, then check the **same public HTTPS URL**
   (bypassing a stale browser cache). Confirm it contains `no marker set` and the
   expected digest. Only then is the public replacement complete.
3. Check earlier runs for lingering `github-pages` deployment artifacts. They
   have one-day retention, but retention is not immediate removal. If the
   marker-bearing artifact remains, obtain approval to delete that specific
   artifact, then delete it from the run's artifacts section (or its documented
   GitHub API). Deleting an artifact does not replace the live page; the clean
   deployment is still required. Do not download or attach the old artifact.
   Remove ignored local marked copies as part of the approved cleanup too.
4. Record the clean deployment URL/run and verification, not the marker or HTML.
   The integration owner can finish the cleanup issue and move the plan to
   `docs/plans/done/` with its issue list after its remaining conditions hold.

Artifact retention does not expire the live Pages site. If deployment fails,
the previous page may still be public: keep the cleanup issue open and report
that blocker. Do not claim removal from third-party caches or downloaded copies.

Reference: [GitHub Pages custom Actions workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
