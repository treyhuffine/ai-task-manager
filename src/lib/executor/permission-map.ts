import type { PermissionMode } from '@/db/types';
import { PERMISSION_MODES } from '@/lib/permissions/modes';

/**
 * The harness boundary for permission modes.
 *
 * App-native modes (`auto_all | auto_edits | ask | plan`, see
 * `src/lib/permissions/modes.ts`) are translated here into the knobs a harness
 * understands. Two of the four already ride agentex's cross-provider
 * abstractions: `auto_all` -> `skipPermissions`, `plan` -> `planMode`. The
 * middle two (`ask`, `auto_edits`) have no generic agentex concept yet, so for
 * the `claude` provider they map to raw `--permission-mode` flags passed via
 * `extraArgs`; other providers handle prompting natively and get no extra flag.
 *
 * When agentex grows generic rungs for the middle two (an `autoEdits` boolean
 * or a normalized `permissionMode` enum on `ProviderConfig`), delete the
 * `extraArgs` arm here and set the generic field instead. This file is the only
 * place that needs to change.
 */
export interface HarnessPermissionConfig {
  /** agentex `ProviderConfig.skipPermissions` — auto-allow everything. */
  skipPermissions?: boolean;
  /** agentex `ProviderConfig.planMode` — read-only, cross-provider. */
  planMode?: boolean;
  /** Provider-native flags appended to the spawn argv. Empty for most modes. */
  extraArgs: string[];
}

/** Claude's `--permission-mode` flag value for the modes that use it, else null. */
function claudePermissionFlag(mode: PermissionMode): string | null {
  switch (mode) {
    case 'auto_all':
      return null; // handled by skipPermissions, no flag
    case 'auto_edits':
      return 'acceptEdits';
    case 'ask':
      return 'default';
    case 'plan':
      return null; // handled by planMode, no flag
    default:
      // Unreachable for a valid PermissionMode. A value only lands here if a
      // stale row survived the vocabulary rename (drizzle/0018) — e.g. a legacy
      // `bypass`/`default`/`accept_edits`. Fail loudly rather than silently
      // downgrading auto-allow to prompt-for-everything.
      throw new Error(
        `Unknown permission mode: ${JSON.stringify(mode)}. Expected one of ${PERMISSION_MODES.join(', ')}. ` +
          `A legacy value likely escaped the drizzle/0018 remap.`,
      );
  }
}

/**
 * Resolve an app permission mode into harness config for `providerType`.
 * `caps.planMode` is the provider's `capabilities.planMode.supported`; plan mode
 * only takes effect where the harness supports it (otherwise it falls through
 * with no flags, matching the prior behavior).
 */
export function harnessPermissionConfig(
  mode: PermissionMode,
  providerType: string,
  caps: { planMode: boolean },
): HarnessPermissionConfig {
  if (mode === 'auto_all') {
    return { skipPermissions: true, extraArgs: [] };
  }
  if (mode === 'plan') {
    return caps.planMode ? { planMode: true, extraArgs: [] } : { extraArgs: [] };
  }
  // ask / auto_edits: only Claude needs an explicit flag today.
  if (providerType === 'claude') {
    const flag = claudePermissionFlag(mode);
    return { extraArgs: flag ? ['--permission-mode', flag] : [] };
  }
  return { extraArgs: [] };
}

/**
 * Single source of truth for which permission modes a provider offers. Both the
 * composer's mode picker and the session PATCH route's validation derive from
 * this, so the per-provider matrix lives in exactly one place.
 *
 * - `cursor` has no interactive permission prompts (it runs with `--force`), so
 *   it offers only `auto_all` (+ `plan` where supported).
 * - `opencode` prompts (so it offers `ask`) but has no accept-edits equivalent,
 *   so it omits `auto_edits`.
 * - everything else (claude, codex) offers the full set.
 * `plan` is included only where the harness supports plan mode.
 */
export function supportedPermissionModes(
  providerType: string,
  planModeSupported: boolean,
): PermissionMode[] {
  const withPlan = (modes: PermissionMode[]): PermissionMode[] =>
    planModeSupported ? [...modes, 'plan'] : modes;
  if (providerType === 'cursor') return withPlan(['auto_all']);
  if (providerType === 'opencode') return withPlan(['auto_all', 'ask']);
  return withPlan(['auto_all', 'auto_edits', 'ask']);
}
