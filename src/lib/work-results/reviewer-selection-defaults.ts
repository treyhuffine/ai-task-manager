import type { HarnessSettingsRecord, UserStateRecord, WorkspaceReviewDefaults } from '@/db/types';
import type { ExplicitHarnessSelection } from '@/lib/harness/options';
import type { HarnessId } from '@/lib/harness/registry';

type Overrides = Partial<{ harness: HarnessId; model: string | null; variant: ExplicitHarnessSelection['variant']; effort: ExplicitHarnessSelection['effort'] }>;
type NormalDefaults = Pick<UserStateRecord, 'defaultHarness' | 'defaultModel' | 'defaultEffort'>;
type HarnessDefaults = Pick<HarnessSettingsRecord, 'defaultModel' | 'defaultVariant' | 'defaultEffort'>;

export function reviewerPreferenceHarness(overrides: Overrides, agent: WorkspaceReviewDefaults | null | undefined, normal: NormalDefaults | null | undefined): HarnessId {
  return overrides.harness ?? agent?.harness ?? normal?.defaultHarness ?? 'claude';
}

/** Only inherit settings from a tuple belonging to the chosen harness and model. */
export function preferredWorkResultReviewerSelection(
  overrides: Overrides, agent: WorkspaceReviewDefaults | null | undefined,
  normal: NormalDefaults | null | undefined, settings: HarnessDefaults,
) {
  const harness = reviewerPreferenceHarness(overrides, agent, normal);
  const agentHarness = agent?.harness ?? normal?.defaultHarness ?? 'claude';
  const agentTuple = harness === agentHarness ? agent : null;
  const normalTuple = harness === normal?.defaultHarness ? normal : null;
  const model = overrides.model ?? agentTuple?.model ?? normalTuple?.defaultModel ?? settings.defaultModel;
  const agentModel = agentTuple?.model ?? normalTuple?.defaultModel ?? settings.defaultModel;
  const sameAgentModel = agentModel === model;
  const sameNormalModel = !!normalTuple && (normalTuple.defaultModel ?? settings.defaultModel) === model;
  const sameSettingsModel = settings.defaultModel === model;
  return {
    harness,
    model,
    variant: overrides.variant !== undefined ? overrides.variant
      : (sameAgentModel ? agentTuple?.variant : null) ?? (sameSettingsModel ? settings.defaultVariant : null),
    effort: overrides.effort !== undefined ? overrides.effort
      : (sameAgentModel ? agentTuple?.effort : null) ?? (sameNormalModel ? normalTuple?.defaultEffort : null)
        ?? (sameSettingsModel ? settings.defaultEffort : null),
  };
}
