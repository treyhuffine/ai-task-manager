import type { EffortLevel } from '@/db/types';
import { ensureHarnessSettings, getUserState } from '@/lib/db/queries';
import { resolveHarnessSelection } from '@/lib/harness/model-discovery';
import type { ExplicitHarnessSelection, ProviderId } from '@/lib/harness/options';
import { DEFAULT_HARNESS } from '@/lib/harness/registry';

/** What a start names. Anything left out comes from a default. */
export interface StartOverride {
  providerId?: ProviderId;
  model?: string | null;
  variant?: string | null;
  effort?: EffortLevel | null;
}

/**
 * The harness, model, variant and effort a new chat or execution starts on
 * (docs/default-selection.md). What the start names wins, and the rest comes
 * from one of two defaults:
 *
 * - No harness named: the global default model (user state).
 * - A harness named: that harness's own default (its settings row), even when
 *   it's the global default's harness. Each harness's default is its own
 *   setting, so naming the harness asks for it.
 *
 * `repairInvalidModel` replaces a model the catalog no longer offers instead of
 * failing. It defaults to on only when the model came from a default, so a
 * model someone named that doesn't exist is an error, not a quiet swap.
 */
export async function resolveStartSelection(
  override: StartOverride,
  options: { cwd?: string; repairInvalidModel?: boolean } = {},
): Promise<ExplicitHarnessSelection> {
  const home = getUserState();
  const providerId = override.providerId ?? home?.defaultHarness ?? DEFAULT_HARNESS;
  const harness = ensureHarnessSettings(providerId);
  const global = !override.providerId && home?.defaultHarness === providerId && home.defaultModel ? home : null;
  const fallback = global
    ? { model: global.defaultModel, variant: global.defaultVariant ?? null, effort: global.defaultEffort ?? null }
    : { model: harness.defaultModel, variant: harness.defaultVariant, effort: harness.defaultEffort };
  const model = override.model ?? fallback.model;
  return resolveHarnessSelection(providerId, {
    model,
    // A variant belongs to its model, so a default's variant only rides along with that model.
    variant: override.variant ?? (model === fallback.model ? fallback.variant : null),
    effort: override.effort ?? fallback.effort,
  }, {
    cwd: options.cwd,
    repairInvalidModel: options.repairInvalidModel ?? override.model == null,
  });
}
