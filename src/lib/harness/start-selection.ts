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
 * (docs/default-selection.md). What the start names wins. Otherwise, on the
 * harness of the home's default for new work, that default. On any other
 * harness, that harness's own default.
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
  const homeDefault = home?.defaultHarness === providerId ? home : null;
  const fallback = homeDefault?.defaultModel
    ? { model: homeDefault.defaultModel, variant: homeDefault.defaultVariant ?? null }
    : { model: harness.defaultModel, variant: harness.defaultVariant };
  const model = override.model ?? fallback.model;
  return resolveHarnessSelection(providerId, {
    model,
    // A variant belongs to its model, so a default's variant only rides along with that model.
    variant: override.variant ?? (model === fallback.model ? fallback.variant : null),
    effort: override.effort ?? homeDefault?.defaultEffort ?? harness.defaultEffort,
  }, {
    cwd: options.cwd,
    repairInvalidModel: options.repairInvalidModel ?? override.model == null,
  });
}
