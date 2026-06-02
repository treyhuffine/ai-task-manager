import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {
  beamdStatus,
  beamdList,
  beamdOpen,
  beamdCheck,
  beamdLogin,
  beamdConnectedServer,
  BeamdCliError,
} from './cli';
import { allocatePort } from '../net';

// These exercise the REAL beamd binary against an unreachable edge, so they
// validate the wrapper's parsing + error classification end-to-end without a
// live edge. Flow drives the machine's `~/.beamd/` account (no --config), so
// we point HOME at a throwaway dir and `beamd login` into it. Gated on
// FLOW_BEAMD_BIN so CI without the binary skips. Run locally with:
//   FLOW_BEAMD_BIN=/path/to/beamd npx vitest run src/lib/preview/beamd/cli.test.ts
const BIN = process.env.FLOW_BEAMD_BIN;
const maybe = BIN ? describe : describe.skip;

let tmpHome: string;
let realHome: string | undefined;
beforeEach(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-beamd-cli-'));
  realHome = process.env.HOME;
  process.env.HOME = tmpHome;
  if (BIN) {
    // Log in to an unreachable edge: `login --token` just stores creds (it
    // doesn't connect), so status/list resolve them while check/open fail.
    await beamdLogin({ server: '127.0.0.1:1', token: 'fake-token-for-integration' });
  }
});
afterEach(() => {
  if (realHome !== undefined) process.env.HOME = realHome;
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

maybe('beamd CLI wrapper (real binary, shared ~/.beamd)', () => {
  it('connectedServer reports the logged-in edge', async () => {
    expect(await beamdConnectedServer()).toContain('127.0.0.1:1');
  }, 12_000);

  it('status --json parses into a structured object', async () => {
    const status = await beamdStatus();
    expect(status).toMatchObject({
      server: expect.any(String),
      agentRunning: expect.any(Boolean),
      healthy: expect.any(Boolean),
    });
    expect(status.healthy).toBe(false); // unreachable edge
  }, 15_000);

  it('list --json returns an array (empty when nothing is up)', async () => {
    expect(Array.isArray(await beamdList())).toBe(true);
  }, 15_000);

  it('check against an unreachable edge throws a classified BeamdCliError', async () => {
    await expect(beamdCheck(8_000)).rejects.toBeInstanceOf(BeamdCliError);
  }, 12_000);

  it('open against an unreachable edge throws a classified BeamdCliError', async () => {
    const port = await allocatePort();
    await expect(beamdOpen(port, 'flow-cli-test', 12_000)).rejects.toBeInstanceOf(BeamdCliError);
  }, 30_000);
});
