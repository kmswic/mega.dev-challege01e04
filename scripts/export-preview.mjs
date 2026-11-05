import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
let clean = false;
let output = 'var/preview/index.html';
let envFile = '.env';

function parseArgs() {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--clean') clean = true;
    else if (['--output', '--env-file'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
      const option = args[i];
      const value = args[++i];
      if (option === '--output') output = value;
      else envFile = value;
    } else throw new Error('Usage: node scripts/export-preview.mjs [--clean] [--output path] [--env-file path]');
  }
  if (clean && args.includes('--env-file')) {
    throw new Error('--clean cannot be combined with --env-file.');
  }
}

async function unusedPort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

function signalChild(child, signal) {
  if (!child.pid) return;
  try {
    // tsx launches a child Node process: terminate the whole private process group.
    if (process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    // macOS may report EPERM for an already-reaped private process group.
    const reapedGroup = error.code === 'EPERM' && (child.exitCode !== null || child.signalCode !== null);
    if (error.code !== 'ESRCH' && !reapedGroup) throw error;
  }
}

async function exportPreview() {
  parseArgs();
  if (!clean && existsSync(resolve(root, envFile))) process.loadEnvFile(resolve(root, envFile));
  const env = { ...process.env };
  if (clean) delete env.LANE_MARKER;
  else if (!env.LANE_MARKER?.trim()) throw new Error('Initial preview requires a nonempty LANE_MARKER.');

  const port = await unusedPort();
  env.PORT = String(port);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  // Do not invoke pnpm start: its --env-file option would restore the marker on cleanup.
  // Child output is deliberately discarded; server diagnostics can contain lane data.
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/server.ts'], {
    cwd: root,
    env,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
  let stopped = false;
  const exited = new Promise((resolve) => {
    child.once('error', () => { stopped = true; resolve(); });
    child.once('exit', () => { stopped = true; resolve(); });
  });

  try {
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      controller.signal.throwIfAborted();
      if (stopped) throw new Error('rig exited before becoming ready. Check installed dependencies and configuration.');
      try {
        const response = await fetch(`${origin}/health`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(500)]),
          redirect: 'error',
        });
        await response.body?.cancel();
        if (response.status === 200) { ready = true; break; }
      } catch {
        controller.signal.throwIfAborted();
      }
      await delay(100, undefined, { signal: controller.signal });
    }
    if (!ready) throw new Error('Timed out waiting for rig.');

    const response = await fetch(`${origin}/digest/2026-10-28`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
      redirect: 'error',
    });
    if (response.status !== 200) throw new Error(`Digest returned HTTP ${response.status}; expected 200.`);
    if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('Digest is not HTML.');
    const html = await response.text();
    if (!/<html\b/i.test(html) || !/<style\b/i.test(html)) throw new Error('Digest must include HTML and inline styles.');
    if (/<(?:script|link|iframe|img|object|embed)\b|\son[a-z]+\s*=|javascript\s*:|@import\b|url\s*\(/i.test(html)) {
      throw new Error('Digest must be self-contained HTML with inline styles and no client JavaScript.');
    }
    if (clean && !/<span\b[^>]*class="marker"[^>]*>no marker set<\/span>/i.test(html)) {
      throw new Error('Clean digest does not show the unset-marker banner.');
    }
    controller.signal.throwIfAborted();
    const destination = resolve(root, output);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, html, { mode: 0o600 });
    console.log(clean ? 'Clean preview exported.' : 'Preview exported.');
  } finally {
    try {
      signalChild(child, 'SIGTERM');
      await Promise.race([exited, delay(2_000, undefined, { ref: false })]);
      // Kill any descendants even if the tsx launcher exited first.
      signalChild(child, 'SIGKILL');
      await exited;
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
    }
  }
}

exportPreview().catch(() => {
  // Never print response HTML, environment values, or child output on failure.
  console.error('Preview export failed. Check dependencies, /health, /digest/2026-10-28, and marker configuration.');
  process.exitCode = 1;
});
