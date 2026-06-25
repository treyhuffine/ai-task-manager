/**
 * Docker-managed Parakeet (speech-to-text) sidecar orchestration.
 *
 * The CLI treats voice as optional:
 *   - `isDockerAvailable()` — daemon reachable
 *   - `isVoiceReady()` — `/health` answering (reuse a warm container if so)
 *   - `startVoiceService()` — `docker compose up -d` (detached)
 *   - `waitForVoiceReady()` — poll `/health` until 200 or timeout
 *   - `stopVoiceService()` — `docker compose stop` (keeps the model volume)
 *
 * Compose-file resolution is centralized here so the dev/published path
 * difference can change later without touching call sites.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

const VOICE_URL = process.env.LOCAL_SPEECH_TO_TEXT_URL ?? 'http://localhost:5092';
const DEFAULT_SERVICE = 'parakeet-cpu';

export interface VoiceContext {
  serviceUrl: string;
  composeFile: string;
  service: string;
}

export function getVoiceContext(overrideService?: string): VoiceContext {
  return {
    serviceUrl: VOICE_URL,
    composeFile: resolveComposeFile(),
    service: overrideService ?? DEFAULT_SERVICE,
  };
}

function resolveComposeFile(): string {
  const override = process.env.FLOW_VOICE_COMPOSE;
  if (override) return override;
  // Dev layout: submodule at repo root.
  // TODO(publish): when shipping via npx, bundle docker-compose.yml into `dist/`
  // and fall back to that path here.
  return path.resolve(process.cwd(), 'modules/parakeet-stt/docker-compose.yml');
}

export async function isDockerAvailable(timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('docker', ['info'], { stdio: 'ignore' });
    let settled = false;
    const done = (val: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };
    // A wedged Docker daemon makes `docker info` hang indefinitely — the CLI
    // is installed, so the 'error' event never fires and we'd wait forever
    // (this blocked `flow start` mid-preflight). Bound it: if the daemon
    // doesn't answer in time, treat Docker as unavailable and SIGKILL the
    // stuck probe so we don't leak a zombie `docker info` on every start.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done(false);
    }, timeoutMs);
    timer.unref();
    child.on('exit', (code) => done(code === 0));
    child.on('error', () => done(false)); // docker CLI not installed
  });
}

export async function isVoiceReady(ctx: VoiceContext = getVoiceContext()): Promise<boolean> {
  try {
    const res = await fetch(`${ctx.serviceUrl}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startVoiceService(ctx: VoiceContext = getVoiceContext()): Promise<void> {
  await runDockerCompose(['-f', ctx.composeFile, 'up', '-d', ctx.service]);
}

export async function stopVoiceService(ctx: VoiceContext = getVoiceContext()): Promise<void> {
  // `stop` halts containers but keeps the model-cache volume for fast restart.
  await runDockerCompose(['-f', ctx.composeFile, 'stop', ctx.service]).catch(() => {
    // Best-effort — we don't want teardown to crash the CLI.
  });
}

export async function waitForVoiceReady(
  ctx: VoiceContext = getVoiceContext(),
  timeoutMs = 180_000, // cold-start can include a model download
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isVoiceReady(ctx)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Voice service did not become ready within ${timeoutMs}ms`);
}

function runDockerCompose(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', ...args], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker compose ${args.join(' ')} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}
