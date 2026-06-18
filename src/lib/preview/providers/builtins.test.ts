import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { getProvider, listProviderIds, PreviewProviderError } from './index';
import type { PreviewContext } from './types';
import { renderManualTemplate } from '../settings';

const ctx: PreviewContext = {
  cwd: '/tmp/flow-a3f9',
  worktreeName: 'flow-a3f9',
  service: null,
  port: 4567,
  workspaceId: 'ws1',
  executionId: 'ex-none',
  previewName: 'flow-a3f9',
};

let tmpRoot: string;
let realHome: string | undefined;
beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-prov-test-'));
  process.env.FLOW_ROOT = tmpRoot;
  // Isolate ~/.beamd to an empty HOME so beamd resolves "not connected"
  // deterministically (Flow uses the machine's account; no --config).
  realHome = process.env.HOME;
  process.env.HOME = tmpRoot;
});
afterEach(() => {
  delete process.env.FLOW_ROOT;
  if (realHome !== undefined) process.env.HOME = realHome;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('built-in providers', () => {
  it('registers the built-ins (portless is off the picker by default)', () => {
    expect(listProviderIds()).toEqual(expect.arrayContaining(['localhost', 'beamd', 'manual']));
    expect(listProviderIds()).not.toContain('portless');
  });

  it('localhost resolves to a loopback URL', async () => {
    const target = await getProvider('localhost').resolve(ctx);
    expect(target.url).toBe('http://localhost:4567');
    expect(target.stop).toBeUndefined(); // static
  });

  it('localhost + beamd manage the local server; manual does not', () => {
    expect(getProvider('localhost').managesLocalServer).toBe(true);
    expect(getProvider('beamd').managesLocalServer).toBe(true);
    expect(getProvider('manual').managesLocalServer).toBe(false);
  });

  it('beamd reports not-connected and resolve surfaces an actionable error', async () => {
    const beamd = getProvider('beamd');
    // Empty HOME → no ~/.beamd account → not connected.
    expect(await beamd.isConfigured?.()).toBe(false);
    await expect(beamd.resolve(ctx)).rejects.toBeInstanceOf(PreviewProviderError);
  }, 20_000);

  it('manual surfaces an actionable error with no URL and no template', async () => {
    // getExecution('ex-none') returns undefined → no urls, no template set.
    await expect(getProvider('manual').resolve(ctx)).rejects.toMatchObject({
      code: 'manual_no_url',
    });
  });
});

describe('renderManualTemplate', () => {
  it('substitutes {name} and {port}', () => {
    expect(renderManualTemplate('https://{name}.my.dev', { name: 'flow-a3f9' })).toBe('https://flow-a3f9.my.dev');
    expect(renderManualTemplate('http://host:{port}', { name: 'x', port: 8080 })).toBe('http://host:8080');
  });
  it('returns null for an empty template', () => {
    expect(renderManualTemplate(null, { name: 'x' })).toBeNull();
    expect(renderManualTemplate('  ', { name: 'x' })).toBeNull();
  });
});
