import { getAgentModels } from '@/lib/agent-model-discovery';
import { modelsForProvider, type ModelOption } from '@/lib/agent-options';
import { isHarnessId } from '@/lib/agents/registry';
import { getAppRoot } from '@/lib/config/paths';
import { ensureAgentHarnessSettings, upsertAgentHarnessSettings } from '@/lib/db/queries';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get('provider');
  if (!isHarnessId(provider)) {
    return Response.json({ error: `unknown provider: ${provider ?? ''}` }, { status: 400 });
  }

  const refresh = url.searchParams.get('refresh') === 'true';
  const cwd = url.searchParams.get('cwd') || getAppRoot();
  const showCatalog = url.searchParams.get('scope') === 'catalog';
  const discovery = await getAgentModels(provider, { cwd, refresh });
  const catalogById = new Map<string, ModelOption>();
  for (const model of [...discovery.models, ...modelsForProvider(provider)]) {
    if (!catalogById.has(model.id)) catalogById.set(model.id, model);
  }
  const catalog = [...catalogById.values()];
  let settings = ensureAgentHarnessSettings(provider);
  if (refresh) {
    settings = upsertAgentHarnessSettings({
      ...settings,
      catalogRefreshedAt: new Date().toISOString(),
    });
  }
  const byId = new Map(catalog.map((model) => [model.id, model]));
  const models: ModelOption[] = catalog.map((model) => ({
    ...model,
    enabled: settings.enabledModels.includes(model.id),
    availability: model.availability ?? 'available',
  }));
  for (const id of settings.enabledModels) {
    if (!byId.has(id)) {
      models.push({
        id,
        label: id,
        enabled: true,
        availability: 'unavailable',
        availabilityReason: 'This model is not in the current provider catalog',
      });
    }
  }

  return Response.json({
    source: discovery.source,
    models: showCatalog
      ? models
      : models.filter((model) => model.enabled && model.availability !== 'unavailable'),
    enabledModelIds: settings.enabledModels,
    defaultModel: settings.defaultModel,
    defaultVariant: settings.defaultVariant,
    defaultEffort: settings.defaultEffort,
    catalogRefreshedAt: settings.catalogRefreshedAt,
  });
}
