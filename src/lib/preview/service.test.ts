import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { resetDb } from '@/lib/db';
import { createWorkspace, createExecution, getPreviewTarget } from '@/lib/db/queries';
import {
  resolvePreview,
  getPreviewState,
  stopPreview,
  previewLogs,
  setPreviewUrls,
} from './service';
import { getSupervisor } from './supervisor';
import { isPortListening } from './net';

const PORT_SERVER = 'node -e "require(\'http\').createServer((q,s)=>s.end(\'hi\')).listen(process.env.PORT)"';

let tmpRoot: string;
let workCwd: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-svc-test-'));
  process.env.FLOW_ROOT = tmpRoot;
  // Point the DB explicitly at the temp root so each test is isolated.
  process.env.FLOW_DB_PATH = path.join(tmpRoot, 'data.db');
  resetDb();
  workCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-svc-cwd-'));
});

afterEach(async () => {
  await getSupervisor().stopAll();
  resetDb();
  delete process.env.FLOW_ROOT;
  delete process.env.FLOW_DB_PATH;
  for (const dir of [tmpRoot, workCwd]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function makeExecution(previewCommand: string | null) {
  const ws = createWorkspace({ name: 'Demo App', cwd: workCwd, isGit: false, previewCommand });
  const exec = createExecution({ workspaceId: ws.id });
  return { ws, exec };
}

describe('preview service (local flow)', () => {
  it('creates a target with a stable port + name and resolves a local URL', async () => {
    const { exec } = makeExecution(PORT_SERVER);

    const state = await resolvePreview(exec.id, { remote: false });
    expect(state.serverStatus).toBe('running');
    expect(state.port).toBeGreaterThan(0);
    expect(state.localUrl).toBe(`http://localhost:${state.port}`);
    expect(state.previewName).toMatch(/^demo-app$/);
    expect(await isPortListening(state.port!, 500)).toBe(true);

    // The desired-state row persists the stable port + name.
    const target = getPreviewTarget(exec.id, null);
    expect(target?.port).toBe(state.assignedPort);
    expect(target?.previewName).toBe('demo-app');
  }, 15_000);

  it('reuses the same port on restart (stable URL)', async () => {
    const { exec } = makeExecution(PORT_SERVER);
    const first = await resolvePreview(exec.id, { remote: false });
    const port1 = first.assignedPort;
    await stopPreview(exec.id);
    const second = await resolvePreview(exec.id, { remote: false });
    expect(second.assignedPort).toBe(port1);
  }, 20_000);

  it('surfaces a clear no-command error', async () => {
    const { exec } = makeExecution(null);
    await expect(resolvePreview(exec.id, { remote: false })).rejects.toMatchObject({ code: 'no_command' });
  });

  it('reports crashed when the dev command exits', async () => {
    const { exec } = makeExecution('node -e "process.exit(2)"');
    const state = await resolvePreview(exec.id, { remote: false });
    expect(state.serverStatus).toBe('crashed');
    expect(state.localUrl).toBeNull();
    expect(state.remoteError?.code).toBe('server_crashed');
  }, 12_000);

  it('streams logs and stops cleanly', async () => {
    const { exec } = makeExecution(
      'node -e "console.log(\'booting\'); require(\'http\').createServer((q,s)=>s.end(\'hi\')).listen(process.env.PORT)"',
    );
    const state = await resolvePreview(exec.id, { remote: false });
    expect(state.serverStatus).toBe('running');

    const logs = previewLogs(exec.id, null, 0);
    expect(logs.lines.some((l) => l.line.includes('booting'))).toBe(true);

    await stopPreview(exec.id);
    expect(getPreviewState(exec.id).serverStatus).toBe('stopped');
  }, 15_000);

  it('remote resolve with local-only settings yields a no_remote_provider state', async () => {
    const { exec } = makeExecution(PORT_SERVER);
    // Default settings → activeProvider 'localhost' → no remote.
    const state = await resolvePreview(exec.id, { remote: true });
    expect(state.remoteError?.code).toBe('no_remote_provider');
    expect(state.remoteUrl).toBeNull();
  });

  it('H1: concurrent resolves converge on one target (no duplicate-key crash)', async () => {
    const { exec } = makeExecution(PORT_SERVER);
    // Fire several resolves at once — they race getOrCreateTarget's
    // check-then-insert against the unique index.
    const states = await Promise.all([
      resolvePreview(exec.id, { remote: false }),
      resolvePreview(exec.id, { remote: false }),
      resolvePreview(exec.id, { remote: false }),
    ]);
    // All succeed and agree on the same stable port (one winning row).
    const ports = new Set(states.map((s) => s.assignedPort));
    expect(ports.size).toBe(1);
    const targets = getPreviewTarget(exec.id, null);
    expect(targets).toBeTruthy();
  }, 20_000);

  it('H2: reallocates a stable port that a foreign process already holds', async () => {
    const { exec, ws } = makeExecution(PORT_SERVER);
    // First resolve assigns + uses a stable port.
    const first = await resolvePreview(exec.id, { remote: false });
    const original = first.assignedPort!;
    await stopPreview(exec.id);

    // A foreign process grabs the stable port while the preview is down.
    const squatter = net.createServer();
    await new Promise<void>((r) => squatter.listen(original, '127.0.0.1', r));
    try {
      const second = await resolvePreview(exec.id, { remote: false });
      // The preview self-healed onto a different free port and came up.
      expect(second.assignedPort).not.toBe(original);
      expect(second.serverStatus).toBe('running');
      expect(second.localUrl).toBe(`http://localhost:${second.port}`);
    } finally {
      await stopPreview(exec.id);
      await new Promise<void>((r) => squatter.close(() => r()));
      void ws;
    }
  }, 20_000);

  it('stores and reads back manual preview URLs', () => {
    const { exec } = makeExecution(PORT_SERVER);
    const urls = setPreviewUrls(exec.id, [{ service: null, url: 'https://abc.ngrok.app', label: 'ngrok' }]);
    expect(urls).toHaveLength(1);
    expect(getPreviewState(exec.id).manualUrls[0].url).toBe('https://abc.ngrok.app');
  });

  it('§10 multi-service: injects the sibling API URL into the web service env', async () => {
    // web echoes whatever API_URL it was started with; api is a plain server.
    const webCmd =
      'node -e "const u=process.env.API_URL||\'NONE\'; require(\'http\').createServer((q,s)=>s.end(\'API=\'+u)).listen(process.env.PORT)"';
    const apiCmd = 'node -e "require(\'http\').createServer((q,s)=>s.end(\'api\')).listen(process.env.PORT)"';
    const { exec } = makeExecution(null); // command comes from flow.preview.json, not the workspace
    fs.writeFileSync(
      path.join(workCwd, 'flow.preview.json'),
      JSON.stringify({
        services: [
          { name: 'web', command: webCmd, primary: true, env: { API_URL: '{api}' } },
          { name: 'api', command: apiCmd },
        ],
      }),
    );

    const state = await resolvePreview(exec.id, { remote: false });
    expect(state.service).toBe('web');
    expect(state.availableServices).toEqual(['web', 'api']);
    expect(state.serverStatus).toBe('running');
    expect(state.previewName).toBe('demo-app-web');

    // The web server should have been handed the api's loopback URL.
    const apiTarget = getPreviewTarget(exec.id, 'api')!;
    const res = await fetch(state.localUrl!);
    const body = await res.text();
    expect(body).toBe(`API=http://localhost:${apiTarget.port}`);

    // Stop tears down BOTH services (web shown + api sibling).
    await stopPreview(exec.id);
    expect(getPreviewState(exec.id).serverStatus).toBe('stopped');
    expect(getSupervisor().isListening(apiTarget.id)).toBe(false);
  }, 20_000);

  it('a pasted manual URL takes precedence for remote, reverting when cleared', async () => {
    const { exec } = makeExecution(PORT_SERVER);
    setPreviewUrls(exec.id, [{ service: null, url: 'https://abc.ngrok.app', label: null }]);

    // Remote resolve uses the manual URL even though the active provider is
    // localhost-only (no server bring-up needed — manual is external).
    const withUrl = await resolvePreview(exec.id, { remote: true });
    expect(withUrl.remoteUrl).toBe('https://abc.ngrok.app');
    expect(withUrl.remoteError).toBeNull();

    // Clearing reverts to the active provider (localhost-only → no remote).
    setPreviewUrls(exec.id, []);
    const cleared = await resolvePreview(exec.id, { remote: true });
    expect(cleared.remoteUrl).toBeNull();
    expect(cleared.remoteError?.code).toBe('no_remote_provider');
  }, 12_000);
});
