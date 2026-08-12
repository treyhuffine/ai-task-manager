import { isHarnessId } from '@/lib/agents/registry';
import { getAgentModelCatalog } from '@/lib/agent-model-discovery';
import {
  ensureAgentHarnessSettings,
  getUserState,
  setActiveHarness,
  setEnabledHarnessModels,
  setHarnessDefaultSelection,
} from '@/lib/db/queries';
import { getAppRoot } from '@/lib/config/paths';
import { EFFORT_LEVELS, type EffortLevel } from '@/db/types';
import { explicitAgentSelection } from '@/lib/agent-options';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: Request) {
  const harness = new URL(request.url).searchParams.get('harness');
  if (!isHarnessId(harness)) return Response.json({ error: 'Unknown harness' }, { status: 400 });
  return Response.json(ensureAgentHarnessSettings(harness));
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!isHarnessId(body.harness)) return Response.json({ error: 'Unknown harness' }, { status: 400 });
    if (!Array.isArray(body.enabledModelIds) || !body.enabledModelIds.every((id) => typeof id === 'string')) {
      return Response.json({ error: 'enabledModelIds must be an array of model IDs' }, { status: 400 });
    }
    const enabled = body.enabledModelIds.map((id) => id.trim()).filter(Boolean);
    const catalog = await getAgentModelCatalog(body.harness, { cwd: getAppRoot() });
    const catalogIds = new Set(catalog.map((model) => model.id));
    const existing = ensureAgentHarnessSettings(body.harness);
    const existingIds = new Set(existing.enabledModels);
    const invalid = enabled.filter((id) => !catalogIds.has(id) && !existingIds.has(id));
    if (invalid.length > 0) {
      return Response.json({ error: `Unknown model IDs: ${invalid.join(', ')}` }, { status: 400 });
    }
    const defaultModel = typeof body.defaultModel === 'string' ? body.defaultModel : undefined;
    if (defaultModel && !enabled.includes(defaultModel)) {
      return Response.json({ error: 'The default model must be enabled' }, { status: 400 });
    }
    const defaultAvailable = Boolean(defaultModel && catalogIds.has(defaultModel));
    const remainsActive = getUserState()?.defaultAgentHarness === body.harness;
    if ((body.makeActive === true || remainsActive) && !defaultAvailable) {
      return Response.json(
        { error: 'The active harness must have an available default model' },
        { status: 409 },
      );
    }
    if (body.defaultVariant != null && typeof body.defaultVariant !== 'string') {
      return Response.json({ error: 'defaultVariant must be a string or null' }, { status: 400 });
    }
    if (body.defaultEffort != null
      && (typeof body.defaultEffort !== 'string' || !EFFORT_LEVELS.includes(body.defaultEffort as EffortLevel))) {
      return Response.json({ error: `Invalid effort. Expected one of ${EFFORT_LEVELS.join(', ')}.` }, { status: 400 });
    }
    const requestedVariant = typeof body.defaultVariant === 'string' ? body.defaultVariant.trim() || null : null;
    const requestedEffort = typeof body.defaultEffort === 'string' ? body.defaultEffort as EffortLevel : null;
    const selection = defaultModel && defaultAvailable
      ? explicitAgentSelection(body.harness, {
        model: defaultModel,
        variant: requestedVariant,
        effort: requestedEffort,
      }, catalog)
      : null;
    if (selection && requestedVariant && selection.variant !== requestedVariant) {
      return Response.json({ error: 'The selected variant is not supported by the default model' }, { status: 400 });
    }
    if (selection && requestedEffort && selection.effort !== requestedEffort) {
      return Response.json({ error: 'The selected effort is not supported by the default model' }, { status: 400 });
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
    return Response.json(settings);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
