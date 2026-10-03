import { describe, expect, it } from 'vitest';
import { PERMISSION_MODES } from '@/lib/permissions/modes';
import { KNOWN_HARNESS_IDS } from '@/lib/harness/registry';
import { harnessPermissionConfig, supportedPermissionModes } from './permission-map';

/**
 * The per-harness permission matrix. The composer's mode picker and the
 * session PATCH route both read `supportedPermissionModes`, so a mode offered
 * here is a promise the harness has to keep.
 */
describe('supportedPermissionModes', () => {
  it('offers each harness only the modes it can apply', () => {
    expect(supportedPermissionModes('claude', true)).toEqual(['auto_all', 'auto_edits', 'ask', 'plan']);
    expect(supportedPermissionModes('codex', true)).toEqual(['auto_all', 'auto_edits', 'ask', 'plan']);
    expect(supportedPermissionModes('cursor', true)).toEqual(['auto_all', 'plan']);
    expect(supportedPermissionModes('opencode', true)).toEqual(['auto_all', 'ask', 'plan']);
    // Headless `agy` has no approval channel: a tool that needs approval is
    // soft-denied by policy, so `ask` and `auto_edits` would never ask.
    expect(supportedPermissionModes('antigravity', true)).toEqual(['auto_all', 'plan']);
  });

  it('drops plan where the installed harness cannot plan', () => {
    for (const harness of KNOWN_HARNESS_IDS) {
      expect(supportedPermissionModes(harness, false)).not.toContain('plan');
      expect(supportedPermissionModes(harness, false)).toContain('auto_all');
    }
    expect(supportedPermissionModes('antigravity', false)).toEqual(['auto_all']);
  });

  it('only ever offers app-native modes', () => {
    for (const harness of KNOWN_HARNESS_IDS) {
      for (const mode of supportedPermissionModes(harness, true)) expect(PERMISSION_MODES).toContain(mode);
    }
  });
});

describe('harnessPermissionConfig', () => {
  it('maps auto mode to skipPermissions on every harness', () => {
    for (const harness of KNOWN_HARNESS_IDS) {
      expect(harnessPermissionConfig('auto_all', harness, { planMode: true })).toEqual({
        skipPermissions: true,
        extraArgs: [],
      });
    }
  });

  it('refuses plan mode when the installed harness cannot apply it', () => {
    // agentex turns this into `agy --mode plan`, which wins over skipPermissions.
    expect(harnessPermissionConfig('plan', 'antigravity', { planMode: true })).toEqual({ planMode: true, extraArgs: [] });
    expect(() => harnessPermissionConfig('plan', 'antigravity', { planMode: false })).toThrow(/not supported/);
  });

  it('adds raw permission flags for Claude only', () => {
    expect(harnessPermissionConfig('auto_edits', 'claude', { planMode: true }).extraArgs)
      .toEqual(['--permission-mode', 'acceptEdits']);
    expect(harnessPermissionConfig('ask', 'claude', { planMode: true }).extraArgs)
      .toEqual(['--permission-mode', 'default']);
    expect(harnessPermissionConfig('ask', 'codex', { planMode: true })).toEqual({ extraArgs: [] });
    expect(harnessPermissionConfig('auto_edits', 'codex', { planMode: true })).toEqual({ extraArgs: [] });
    expect(harnessPermissionConfig('ask', 'opencode', { planMode: true })).toEqual({ extraArgs: [] });
    for (const harness of ['cursor', 'antigravity']) {
      for (const mode of ['ask', 'auto_edits'] as const) {
        expect(() => harnessPermissionConfig(mode, harness, { planMode: true })).toThrow(/not supported/);
      }
    }
    expect(() => harnessPermissionConfig('auto_edits', 'opencode', { planMode: true })).toThrow(/not supported/);
  });

  it('refuses a legacy mode instead of downgrading it', () => {
    expect(() => harnessPermissionConfig('bypass' as never, 'claude', { planMode: true })).toThrow(/not supported/);
  });
});
