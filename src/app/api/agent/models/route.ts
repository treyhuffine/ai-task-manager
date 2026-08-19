import { getAgentModels } from '@/lib/agent-model-discovery';
import { customModelOption, modelsForProvider, type ModelOption } from '@/lib/agent-options';
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
  // Discovery wins on everything the provider is authoritative about, but the
  // hint is picker copy, not provider data. A bundled hint answers "which of
  // these should I pick" ("latest · fast + cheap"); a provider description
  // answers "what is this" ("Always resolves to the newest Haiku release"),
  // which reads nearly identical across a tier family and stops helping anyone
  // choose. So the curated line wins where we have one, and the provider's
  // fills in everything we never wrote copy for.
  const bundledHints = new Map(
    modelsForProvider(provider).map((model) => [model.id, model.hint] as const),
  );
  const catalogById = new Map<string, ModelOption>();
  for (const model of [...discovery.models, ...modelsForProvider(provider)]) {
    if (catalogById.has(model.id)) continue;
    const curated = bundledHints.get(model.id);
    catalogById.set(model.id, curated ? { ...model, hint: curated } : model);
  }
  let settings = ensureAgentHarnessSettings(provider);
  if (refresh) {
    settings = upsertAgentHarnessSettings({
      ...settings,
      catalogRefreshedAt: new Date().toISOString(),
    });
  }
  // Pinned ids extend the catalog rather than replacing entries in it: one
  // that shadows a discovered model keeps that model's efforts, variants and
  // context window and only gains the badge that makes it removable.
  const pinned = new Set(settings.customModels);
  for (const id of settings.customModels) {
    if (!catalogById.has(id)) catalogById.set(id, customModelOption(id));
  }
  const catalog = [...catalogById.values()];
  const byId = new Map(catalog.map((model) => [model.id, model]));
  const models: ModelOption[] = catalog.map((model) => ({
    ...model,
    enabled: settings.enabledModels.includes(model.id),
    availability: model.availability ?? 'available',
    ...(pinned.has(model.id) ? { custom: true } : {}),
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
    customModelIds: settings.customModels,
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
