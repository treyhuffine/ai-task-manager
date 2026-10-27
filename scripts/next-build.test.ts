import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CANARY_DIR, memoryLimitBytes, reservedBytes, runWithMemoryLimit, tracesListingCanary, treeResidentBytes } from './next-build.mjs';

const GB = 2 ** 30;
const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-next-build-'));
  temporary.push(dir);
  return dir;
}

describe('treeResidentBytes', () => {
  it('counts the build and everything below it, not its neighbours', () => {
    const ps = ['    1     0  9999', '  100     1  1000', '  101   100  2000', '  102   101  3000', '  200     1  50000', 'garbage line'].join('\n');
    expect(treeResidentBytes(ps, 100)).toBe((1000 + 2000 + 3000) * 1024);
    expect(treeResidentBytes(ps, 102)).toBe(3000 * 1024);
    expect(treeResidentBytes(ps, 404)).toBe(0);
  });
});

describe('reservedBytes', () => {
  it('reads macOS compressed pages at the reported page size, plus swap', () => {
    const vmStat = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:     3580.\nPages stored in compressor:     1000.\n';
    expect(reservedBytes({ vmStat, swapUsage: 'total = 8192.00M  used = 512.00M  free = 7680.00M  (encrypted)' })).toBe(1000 * 16384 + 512 * 2 ** 20);
    expect(reservedBytes({ swapUsage: 'total = 2.00G  used = 1.50G  free = 0.50G' })).toBe(1.5 * GB);
  });
  it('reads Linux swap in use', () => {
    expect(reservedBytes({ meminfo: 'MemTotal:  16000000 kB\nSwapTotal:  4000000 kB\nSwapFree:   3000000 kB\n' })).toBe(1000000 * 1024);
  });
});

describe('memoryLimitBytes', () => {
  it('defaults to this computer’s memory and takes a limit in GB, or 0 for none', () => {
    expect(memoryLimitBytes({}, 32 * GB)).toBe(32 * GB);
    expect(memoryLimitBytes({ RI_BUILD_MEMORY_LIMIT_GB: '12.5' }, 32 * GB)).toBe(12.5 * GB);
    expect(memoryLimitBytes({ RI_BUILD_MEMORY_LIMIT_GB: '0' }, 32 * GB)).toBe(0);
    expect(memoryLimitBytes({ RI_BUILD_MEMORY_LIMIT_GB: ' ' }, 32 * GB)).toBe(32 * GB);
    expect(() => memoryLimitBytes({ RI_BUILD_MEMORY_LIMIT_GB: 'lots' }, 32 * GB)).toThrow(/number of GB/);
  });
});

describe('tracesListingCanary', () => {
  it('names each server trace that lists a canary file, skipping the build cache', () => {
    const dist = tempDir();
    const canary = path.join(dist, '..', path.basename(dist) + '-canary');
    fs.mkdirSync(canary);
    temporary.push(canary);
    const trace = (file: string, listed: string[]) => {
      fs.mkdirSync(path.dirname(path.join(dist, file)), { recursive: true });
      fs.writeFileSync(path.join(dist, file), JSON.stringify({ version: 1, files: listed.map(f => path.relative(path.dirname(path.join(dist, file)), f)) }));
    };
    trace('server/app/api/tasks/route.js.nft.json', [path.join(canary, 'trace-canary.json'), '/repo/node_modules/x/index.js']);
    trace('server/app/page.js.nft.json', ['/repo/node_modules/x/index.js', path.join(dist, 'server/chunks/a.js')]);
    trace('server/middleware.js.nft.json', [path.join(canary, 'trace-canary')]);
    trace('cache/old/route.js.nft.json', [path.join(canary, 'trace-canary')]);
    // A sibling folder whose name starts the same is not the canary.
    trace('server/app/other/route.js.nft.json', [canary + '-elsewhere/file.json']);
    expect(tracesListingCanary(dist, canary)).toEqual([path.join('server', 'app', 'api', 'tasks', 'route.js.nft.json'), path.join('server', 'middleware.js.nft.json')]);
  });

  it('ships canaries for the shapes that sweep a full checkout', () => {
    expect(fs.readdirSync(CANARY_DIR).sort()).toEqual(['trace-canary', 'trace-canary.js', 'trace-canary.json', 'trace-canary.md', 'trace-canary.ts', 'trace-canary.txt']);
  });
});

describe.skipIf(process.platform === 'win32')('runWithMemoryLimit', () => {
  const idle = ['-e', 'setInterval(() => {}, 1000)'];
  const fixed = (bytes: number) => ({ baseline: async () => 0, sample: async () => bytes, intervalMs: 20 });

  it('stops the whole process group once it passes the limit', async () => {
    const result = await runWithMemoryLimit(process.execPath, idle, { limit: GB, ...fixed(2 * GB) });
    expect(result).toMatchObject({ signal: 'SIGKILL', stoppedAt: 2 * GB, peak: 2 * GB });
  });

  it('passes a build’s own exit code through and records its peak', async () => {
    const result = await runWithMemoryLimit(process.execPath, ['-e', 'setTimeout(() => process.exit(3), 300)'], { limit: 4 * GB, ...fixed(GB) });
    expect(result).toEqual({ code: 3, signal: null, peak: GB, stoppedAt: null });
  });

  it('never stops a build on a failed sample, or with no limit', async () => {
    const short = ['-e', 'setTimeout(() => {}, 300)'];
    const failing = await runWithMemoryLimit(process.execPath, short, { limit: 1, intervalMs: 20, baseline: async () => 0, sample: async () => { throw new Error('ps is missing'); } });
    expect(failing).toMatchObject({ code: 0, stoppedAt: null });
    const unlimited = await runWithMemoryLimit(process.execPath, short, { limit: 0, ...fixed(100 * GB) });
    expect(unlimited).toMatchObject({ code: 0, stoppedAt: null, peak: 0 });
  });

  it('passes Ctrl-C and termination on to the detached build', async () => {
    const running = runWithMemoryLimit(process.execPath, idle, { limit: 0 });
    await new Promise(resolve => setTimeout(resolve, 300));
    process.emit('SIGTERM');
    expect(await running).toMatchObject({ signal: 'SIGTERM', stoppedAt: null });
    expect(process.listenerCount('SIGTERM')).toBe(0);
  });

  it('measures a real process tree and stops one that keeps allocating', async () => {
    const hog = ['-e', 'const kept = []; setInterval(() => kept.push(Buffer.alloc(64 << 20, 1)), 50)'];
    const result = await runWithMemoryLimit(process.execPath, hog, { limit: 400 * 2 ** 20, intervalMs: 100 });
    expect(result.signal).toBe('SIGKILL');
    expect(result.stoppedAt).toBeGreaterThan(400 * 2 ** 20);
  }, 20_000);
});
