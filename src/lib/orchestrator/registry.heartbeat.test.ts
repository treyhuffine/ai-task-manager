/**
 * get_heartbeat / update_heartbeat, and the per-trigger locks that let the
 * heartbeat's instructions be edited while the other managed triggers stay
 * locked. See docs/heartbeat-spec.md §4.2 and §6.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ capabilities: { concurrentSend: true } }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));
vi.mock('@/lib/executor/adapter', () => ({
  dispatch: vi.fn(async () => {}),
  abort: vi.fn(async () => {}),
  ExecutorError: class extends Error {},
}));

vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });

const TEST_DB = path.join(os.tmpdir(), `ri-registry-heartbeat-test-${process.pid}.db`);

function wipe() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

beforeEach(async () => {
  wipe();
  process.env.RI_DB_PATH = TEST_DB;
  const { resetDb } = await import('@/lib/db');
  resetDb();
});

afterAll(wipe);

const HEARTBEAT_ID = '00000000-0000-0000-0000-000000000005';
const MORNING_DECK_ID = '00000000-0000-0000-0000-000000000001';

async function run(name: string, input: Record<string, unknown> = {}) {
  const { runAction } = await import('./dispatch');
  return runAction(name, input, { remote: false });
}

describe('get_heartbeat / update_heartbeat', () => {
  it('both actions are registered, and update_heartbeat is mutating', async () => {
    const { actions } = await import('./registry');
    expect(actions.find((a) => a.name === 'get_heartbeat')?.mutating).toBeFalsy();
    expect(actions.find((a) => a.name === 'update_heartbeat')?.mutating).toBe(true);
  });

  it('get_heartbeat seeds the row on a fresh database', async () => {
    const env = await run('get_heartbeat');
    expect(env.ok).toBe(true);
    expect(env.result).toMatchObject({ triggerId: HEARTBEAT_ID, enabled: false, instructionsAreDefault: true });
  });

  it('turns on, sets instructions, cadence, and hours, and echoes the whole config', async () => {
    const env = await run('update_heartbeat', {
      enabled: true,
      instructions: '  Watch my inbox tasks.  ',
      intervalSeconds: 7200,
      activeHoursStart: '08:00',
      activeHoursEnd: '18:30',
      timezone: 'America/Denver',
    });
    expect(env.ok).toBe(true);
    expect(env.result).toMatchObject({
      enabled: true,
      instructions: 'Watch my inbox tasks.',
      instructionsAreDefault: false,
      intervalSeconds: 7200,
      activeHoursStart: '08:00',
      activeHoursEnd: '18:30',
      timezone: 'America/Denver',
    });
    expect((env.result as { nextCheckInAt: string | null }).nextCheckInAt).not.toBeNull();
  });

  it('resetInstructions restores the default, and cannot be combined with instructions', async () => {
    const { DEFAULT_HEARTBEAT_INSTRUCTIONS } = await import('@/lib/heartbeat/constants');
    await run('update_heartbeat', { instructions: 'Something else.' });
    const reset = await run('update_heartbeat', { resetInstructions: true });
    expect(reset.result).toMatchObject({ instructions: DEFAULT_HEARTBEAT_INSTRUCTIONS, instructionsAreDefault: true });

    const both = await run('update_heartbeat', { resetInstructions: true, instructions: 'x' });
    expect(both).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  });

  it('clears active hours together for any time of day', async () => {
    const env = await run('update_heartbeat', { activeHoursStart: null, activeHoursEnd: null });
    expect(env.result).toMatchObject({ activeHoursStart: null, activeHoursEnd: null });
  });

  it.each([
    [{ intervalSeconds: 600 }, /intervalSeconds must be one of/],
    [{ activeHoursStart: null }, /together/],
    [{ activeHoursStart: '25:00' }, /HH:MM/],
    [{ activeHoursStart: '09:00', activeHoursEnd: '09:00' }, /must differ/],
    [{ timezone: 'Mars/Olympus_Mons' }, /Unknown timezone/],
    [{ instructions: '   ' }, /./],
  ])('rejects %j', async (input, message) => {
    const env = await run('update_heartbeat', input);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('invalid_params');
    expect(`${env.error?.message} ${JSON.stringify(env.error?.issues ?? '')}`).toMatch(message);
  });

  it('a provider switch resets model and effort unless restated', async () => {
    await run('update_heartbeat', { model: 'claude-opus-4-8', effort: 'high' });
    const switched = await run('update_heartbeat', { provider: 'codex' });
    expect(switched.ok).toBe(true);
    expect(switched.result).toMatchObject({ provider: 'codex', model: null, effort: null });
  });

  it('rejects a model that cannot run on the provider', async () => {
    const env = await run('update_heartbeat', { model: 'gpt-5.5' });
    expect(env).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  });

  it('is safe to retry: the same patch twice leaves the same config', async () => {
    const a = await run('update_heartbeat', { enabled: true, intervalSeconds: 3600 });
    const b = await run('update_heartbeat', { enabled: true, intervalSeconds: 3600 });
    expect(b.result).toEqual(a.result);
  });
});

describe('per-trigger locks on managed triggers', () => {
  it('the heartbeat accepts edits to its instructions, schedule, and runs-on', async () => {
    await run('get_heartbeat');
    const env = await run('update_trigger', {
      id: HEARTBEAT_ID,
      prompt: 'Edited from the Triggers screen.',
      intervalSeconds: 1800,
      activeHoursStart: '10:00',
      activeHoursEnd: '16:00',
      provider: 'codex',
    });
    expect(env.ok).toBe(true);
    expect(env.result).toMatchObject({ prompt: 'Edited from the Triggers screen.', harness: 'codex' });
  });

  it.each([
    [{ name: 'Renamed' }, 'name'],
    [{ description: 'x' }, 'description'],
    [{ concurrencyPolicy: 'allow_concurrent' }, 'concurrencyPolicy'],
    [{ catchUpPolicy: 'run_all' }, 'catchUpPolicy'],
    [{ timeoutSeconds: 99999 }, 'timeoutSeconds'],
  ])('the heartbeat rejects %j', async (patch, field) => {
    await run('get_heartbeat');
    const env = await run('update_trigger', { id: HEARTBEAT_ID, ...patch });
    expect(env).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(env.error?.message).toContain(field);
  });

  it('the morning deck still locks its prompt', async () => {
    const { ensureMorningDeckTrigger } = await import('@/lib/deck/trigger');
    ensureMorningDeckTrigger();
    const env = await run('update_trigger', { id: MORNING_DECK_ID, prompt: 'Do something else.' });
    expect(env).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(env.error?.message).toContain('prompt');
  });

  it('the heartbeat is turned off, never deleted', async () => {
    await run('get_heartbeat');
    const env = await run('delete_trigger', { id: HEARTBEAT_ID });
    expect(env).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });
});
