import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { getProvider, listProviderIds, PreviewProviderError } from './index';
import type { PreviewContext } from './types';
import { renderManualTemplate } from '../settings';

const ctx: PreviewContext = {
  worktreeName: 'flow-a3f9',
  service: null,
  port: 4567,
  workspaceId: 'ws1',
  executionId: 'ex-none',
  previewName: 'flow-a3f9',
};

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-prov-test-'));
  process.env.FLOW_ROOT = tmpRoot;
});
afterEach(() => {
  delete process.env.FLOW_ROOT;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('built-in providers', () => {
  it('registers all four built-ins', () => {
    expect(listProviderIds()).toEqual(expect.arrayContaining(['localhost', 'beamd', 'portless', 'manual']));
  });

  it('localhost resolves to a loopback URL', async () => {
    const target = await getProvider('localhost').resolve(ctx);
    expect(target.url).toBe('http://localhost:4567');
    expect(target.stop).toBeUndefined(); // static
  });

  it('localhost manages the local server; portless/manual do not', () => {
    expect(getProvider('localhost').managesLocalServer).toBe(true);
    expect(getProvider('beamd').managesLocalServer).toBe(true);
    expect(getProvider('portless').managesLocalServer).toBe(false);
    expect(getProvider('manual').managesLocalServer).toBe(false);
  });

  it('beamd is not configured and resolve surfaces an actionable error', async () => {
    const beamd = getProvider('beamd');
    expect(await beamd.isConfigured?.()).toBe(false);
    await expect(beamd.resolve(ctx)).rejects.toMatchObject({
      code: 'beamd_not_configured',
    });
    await expect(beamd.resolve(ctx)).rejects.toBeInstanceOf(PreviewProviderError);
  });

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
