import { getAppRoot } from '@/lib/config/paths';
import { HARNESS_REGISTRY, type HarnessId } from '@/lib/harness/registry';
import { assertServiceTier, serviceTierForModel } from '@/lib/harness/service-tiers';
import { explicitHarnessSelection } from '@/lib/harness/options';
import type { TriggerRecord } from '@/db/types';

/** Scheduled NULL models use the first runnable catalog entry at dispatch. */
export async function triggerSpeedModel(harness: HarnessId, model: string | null | undefined) {
  const { getHarnessModelCatalog } = await import('@/lib/harness/model-discovery');
  const catalog = await getHarnessModelCatalog(harness, { cwd: getAppRoot() });
  return catalog.find(option => option.id === model) ?? (model == null ? catalog[0] : undefined);
}

/** Only new or changed selections initialize speed. Never retune an existing NULL row. */
export async function speedForTriggerModel(harness: HarnessId, model: string | null | undefined, preferred?: string | null) {
  if (!HARNESS_REGISTRY[harness].maximumCapabilities.serviceTiers) return null;
  return serviceTierForModel(await triggerSpeedModel(harness, model), preferred);
}

/** One live model/effort/speed snapshot for every chat created by a fire. */
export async function resolveTriggerSelection(trigger: Pick<TriggerRecord, 'harness' | 'model' | 'effort' | 'serviceTier'>) {
  const model = await triggerSpeedModel(trigger.harness, trigger.model);
  if (!model) throw new Error(`Model ${trigger.model ?? '(provider default)'} is unavailable for ${trigger.harness}. Refresh models or choose an available model.`);
  assertServiceTier(model, trigger.serviceTier);
  const modelCatalog = [model];
  const selection = explicitHarnessSelection(trigger.harness, trigger, modelCatalog);
  // Dispatch never initializes a legacy NULL. An explicit tier is canonicalized
  // against this same model, without inheriting a provider's paid default.
  selection.serviceTier = trigger.serviceTier == null ? null : serviceTierForModel(model, trigger.serviceTier);
  return { selection, modelCatalog };
}
