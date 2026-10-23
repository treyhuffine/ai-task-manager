import type { ModelOption } from '@/lib/harness/options';

/** Recent choices keep the menu short even when every catalog model is enabled. */
export function compactModels(
  models: readonly ModelOption[],
  recentModelIds: readonly string[],
  selectedModel: string | null,
  defaultModel: string | null,
): ModelOption[] {
  const available = models.filter(model => model.availability !== 'unavailable');
  const byId = new Map(available.map(model => [model.id, model]));
  const recent = [...new Set(recentModelIds)].flatMap(id => byId.get(id) ?? []).slice(0, 2);
  const fallback = byId.get(defaultModel ?? '') ?? available[0];
  const rows = recent.length ? recent : fallback ? [fallback] : [];
  const selected = models.find(model => model.id === selectedModel);
  return selected && !rows.some(model => model.id === selected.id) ? [selected, ...rows] : rows;
}
