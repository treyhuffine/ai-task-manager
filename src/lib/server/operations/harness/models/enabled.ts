import { EFFORT_LEVELS, type EffortLevel } from '@/db/types';
import { getAppRoot } from '@/lib/config/paths';
import {
  ensureHarnessSettings,
  getUserState,
  setActiveHarness,
  setEnabledHarnessModels,
  setHarnessDefaultSelection,
} from '@/lib/db/queries';
import { getHarnessModelCatalog } from '@/lib/harness/model-discovery';
import { explicitHarnessSelection } from '@/lib/harness/options';
import { isHarnessId } from '@/lib/harness/registry';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  const harness = new URL(request.url).searchParams.get('harness');
  if (!isHarnessId(harness)) return reply({ error: 'Unknown harness' }, { status: 400 });
  return reply(ensureHarnessSettings(harness));
}

export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, _request: OperationContext) {
  try {
    const body = rpcInput.body as Record<string, unknown>;
    if (!isHarnessId(body.harness)) return reply({ error: 'Unknown harness' }, { status: 400 });
    if (!Array.isArray(body.enabledModelIds) || !body.enabledModelIds.every((id) => typeof id === 'string')) {
      return reply({ error: 'enabledModelIds must be an array of model IDs' }, { status: 400 });
    }
    const enabled = body.enabledModelIds.map((id) => id.trim()).filter(Boolean);
    const catalog = await getHarnessModelCatalog(body.harness, { cwd: getAppRoot() });
    const catalogIds = new Set(catalog.map((model) => model.id));
    const existing = ensureHarnessSettings(body.harness);
    const existingIds = new Set(existing.enabledModels);
    const invalid = enabled.filter((id) => !catalogIds.has(id) && !existingIds.has(id));
    if (invalid.length > 0) {
      return reply({ error: `Unknown model IDs: ${invalid.join(', ')}` }, { status: 400 });
    }
    const defaultModel = typeof body.defaultModel === 'string' ? body.defaultModel : undefined;
    if (defaultModel && !enabled.includes(defaultModel)) {
      return reply({ error: 'The default model must be enabled' }, { status: 400 });
    }
    const defaultAvailable = Boolean(defaultModel && catalogIds.has(defaultModel));
    const remainsActive = getUserState()?.defaultHarness === body.harness;
    if ((body.makeActive === true || remainsActive) && !defaultAvailable) {
      return reply(
        { error: 'The active harness must have an available default model' },
        { status: 409 },
      );
    }
    if (body.defaultVariant != null && typeof body.defaultVariant !== 'string') {
      return reply({ error: 'defaultVariant must be a string or null' }, { status: 400 });
    }
    if (body.defaultEffort != null
      && (typeof body.defaultEffort !== 'string' || !EFFORT_LEVELS.includes(body.defaultEffort as EffortLevel))) {
      return reply({ error: `Invalid effort. Expected one of ${EFFORT_LEVELS.join(', ')}.` }, { status: 400 });
    }
    const requestedVariant = typeof body.defaultVariant === 'string' ? body.defaultVariant.trim() || null : null;
    const requestedEffort = typeof body.defaultEffort === 'string' ? body.defaultEffort as EffortLevel : null;
    const selection = defaultModel && defaultAvailable
      ? explicitHarnessSelection(body.harness, {
        model: defaultModel,
        variant: requestedVariant,
        effort: requestedEffort,
      }, catalog)
      : null;
    if (selection && requestedVariant && selection.variant !== requestedVariant) {
      return reply({ error: 'The selected variant is not supported by the default model' }, { status: 400 });
    }
    if (selection && requestedEffort && selection.effort !== requestedEffort) {
      return reply({ error: 'The selected effort is not supported by the default model' }, { status: 400 });
    }
    let settings = setEnabledHarnessModels(body.harness, enabled, defaultModel);
    if (settings.defaultModel) {
      const retainingUnavailable = !catalogIds.has(settings.defaultModel)
        && settings.defaultModel === existing.defaultModel;
      settings = setHarnessDefaultSelection(body.harness, {
        model: settings.defaultModel,
        variant: selection?.variant ?? (retainingUnavailable ? existing.defaultVariant : null),
        effort: selection?.effort ?? (retainingUnavailable ? existing.defaultEffort : null),
      });
    }
    if (body.makeActive === true) settings = setActiveHarness(body.harness);
    return reply(settings);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "harness": rpcZ.string().optional() }).strict().optional() }).strict().default({});
export const PUTInput = rpcZ.object({ body: rpcZ.object({ "harness": rpcZ.enum(["cursor", "antigravity", "claude", "codex", "opencode"]), "enabledModelIds": rpcZ.array(rpcZ.string()), "defaultModel": rpcZ.string().nullable(), "defaultVariant": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional(), "defaultEffort": rpcZ.union([rpcZ.null(), rpcZ.literal("low"), rpcZ.literal("medium"), rpcZ.literal("high"), rpcZ.literal("xhigh"), rpcZ.literal("max"), rpcZ.literal("ultra")]).optional(), "makeActive": rpcZ.boolean().optional() }).strict() }).strict();
