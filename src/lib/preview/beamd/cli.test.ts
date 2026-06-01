import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { writeBeamdConfig } from './config';
import {
  beamdStatus,
  beamdList,
  beamdOpen,
  beamdCheck,
  BeamdCliError,
  setBeamdBinOverride,
} from './cli';
import { allocatePort } from '../net';

// These exercise the REAL beamd binary against an unreachable edge, so they
// validate the wrapper's parsing + error classification end-to-end without
// needing a live edge or a real cert. Gated on FLOW_BEAMD_BIN so CI without
// the binary skips cleanly. Run locally with:
//   FLOW_BEAMD_BIN=/path/to/beamd npx vitest run src/lib/preview/beamd/cli.test.ts
const BIN = process.env.FLOW_BEAMD_BIN;
const maybe = BIN ? describe : describe.skip;

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-beamd-cli-'));
  process.env.FLOW_ROOT = tmpRoot;
  if (BIN) setBeamdBinOverride(BIN);
  // Point at an unreachable edge so calls fail fast but the binary still
  // parses flags + emits its JSON/error contract.
  writeBeamdConfig({ server: '127.0.0.1:1', token: 'fake-token-for-integration' });
});
afterEach(() => {
  setBeamdBinOverride(null);
  delete process.env.FLOW_ROOT;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

maybe('beamd CLI wrapper (real binary)', () => {
  it('status --json parses into a structured object', async () => {
    const status = await beamdStatus();
    expect(status).toMatchObject({
      server: expect.any(String),
      agentRunning: expect.any(Boolean),
      healthy: expect.any(Boolean),
    });
    // Unreachable edge → not healthy, no agent.
    expect(status.healthy).toBe(false);
  }, 15_000);

  it('list --json returns an array (empty when nothing is up)', async () => {
    const list = await beamdList();
    expect(Array.isArray(list)).toBe(true);
  }, 15_000);

  it('check against an unreachable edge throws a classified BeamdCliError', async () => {
    await expect(beamdCheck(8_000)).rejects.toBeInstanceOf(BeamdCliError);
  }, 12_000);

  it('open against an unreachable edge throws a classified BeamdCliError', async () => {
    const port = await allocatePort();
    await expect(beamdOpen(port, 'flow-cli-test', 12_000)).rejects.toBeInstanceOf(BeamdCliError);
    try {
      await beamdOpen(port, 'flow-cli-test', 12_000);
    } catch (err) {
      expect(err).toBeInstanceOf(BeamdCliError);
      // Unreachable edge → the agent can't start.
      expect((err as BeamdCliError).code).toBe('beamd_agent_down');
    }
  }, 30_000);
});
