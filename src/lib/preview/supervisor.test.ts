import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { getSupervisor } from './supervisor';
import { allocatePort, isPortListening } from './net';

// Keep the pid-store writes off the real brain dir during tests.
let tmpRoot: string;
beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-sup-test-'));
  process.env.FLOW_ROOT = tmpRoot;
});

const startedKeys: string[] = [];
afterEach(async () => {
  const sup = getSupervisor();
  await Promise.all(startedKeys.splice(0).map((k) => sup.stop(k)));
  delete process.env.FLOW_ROOT;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

/** A one-liner Node HTTP server that honors $PORT — stands in for a dev server. */
const PORT_RESPECTING = 'node -e "require(\'http\').createServer((q,s)=>s.end(\'ok\')).listen(process.env.PORT)"';
/** Honors a hardcoded port, ignoring $PORT — exercises the detector fallback. */
function portIgnoring(hardPort: number) {
  return `node -e "const p=${hardPort}; const s=require('http').createServer((q,s)=>s.end('ok')); s.listen(p,()=>console.log('listening on http://localhost:'+p))"`;
}

describe('supervisor', () => {
  it('injects PORT, confirms listening, and reports the assigned port', async () => {
    const key = `test-${Date.now()}-a`;
    startedKeys.push(key);
    const port = await allocatePort();

    const sup = getSupervisor();
    const rec = await sup.start({ key, command: PORT_RESPECTING, cwd: process.cwd(), port });
    expect(rec.status).toBe('starting');
    expect(rec.assignedPort).toBe(port);

    const settled = await sup.awaitListening(key, 10_000);
    expect(settled?.status).toBe('running');
    expect(settled?.port).toBe(port);
    expect(await isPortListening(port, 500)).toBe(true);
  }, 15_000);

  it('falls back to the stdout detector when the app ignores PORT', async () => {
    const key = `test-${Date.now()}-b`;
    startedKeys.push(key);
    const assigned = await allocatePort();
    const actual = await allocatePort();

    const sup = getSupervisor();
    await sup.start({ key, command: portIgnoring(actual), cwd: process.cwd(), port: assigned });
    const settled = await sup.awaitListening(key, 10_000);
    expect(settled?.status).toBe('running');
    expect(settled?.port).toBe(actual);
  }, 15_000);

  it('marks crashed when the command exits immediately', async () => {
    const key = `test-${Date.now()}-c`;
    startedKeys.push(key);
    const port = await allocatePort();

    const sup = getSupervisor();
    await sup.start({ key, command: 'node -e "process.exit(1)"', cwd: process.cwd(), port });
    const settled = await sup.awaitListening(key, 8_000);
    expect(settled?.status).toBe('crashed');
    expect(settled?.exitCode).toBe(1);
  }, 12_000);

  it('is idempotent — a second start returns the existing record', async () => {
    const key = `test-${Date.now()}-d`;
    startedKeys.push(key);
    const port = await allocatePort();

    const sup = getSupervisor();
    const first = await sup.start({ key, command: PORT_RESPECTING, cwd: process.cwd(), port });
    const second = await sup.start({ key, command: PORT_RESPECTING, cwd: process.cwd(), port });
    expect(second.pid).toBe(first.pid);
  }, 12_000);

  it('stop tears the process down', async () => {
    const key = `test-${Date.now()}-e`;
    startedKeys.push(key);
    const port = await allocatePort();

    const sup = getSupervisor();
    await sup.start({ key, command: PORT_RESPECTING, cwd: process.cwd(), port });
    await sup.awaitListening(key, 10_000);
    const stopped = await sup.stop(key);
    expect(stopped?.status).toBe('stopped');
    // Port should free up shortly after teardown.
    await vi.waitFor(async () => {
      expect(await isPortListening(port, 300)).toBe(false);
    }, { timeout: 5_000, interval: 200 });
  }, 18_000);
});
