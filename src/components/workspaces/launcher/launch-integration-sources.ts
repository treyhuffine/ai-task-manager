import type { IntegrationTaskResult } from '@/lib/integrations/task-sources';
import type { LaunchSourceGroup } from './use-launch-sources';

/** Account groups retain independent rows, failures and paging state. */
export function integrationTaskGroups(
  result: IntegrationTaskResult | undefined,
  state: { isLoading: boolean; isFetching: boolean; error: string | null },
): LaunchSourceGroup[] {
  if (!result?.sources.length) return state.isLoading ? [{
    id: 'integration:loading', kind: 'integration', label: 'Connected tools',
    ...state, items: [],
  }] : [];

  const failures = new Map(result.failures.map((failure) => [failure.sourceKey, failure.error]));
  return result.sources.map((source) => {
    const multiple = result.sources.some((other) => other.toolkitId === source.toolkitId && other.sourceKey !== source.sourceKey);
    return {
      id: `integration:${source.sourceKey}`,
      kind: 'integration',
      label: multiple ? `${source.providerLabel} · ${source.accountLabel}` : source.providerLabel,
      toolkitId: source.toolkitId,
      ...state,
      error: state.error ?? failures.get(source.sourceKey) ?? null,
      truncated: source.truncated,
      items: result.items.filter((item) => item.sourceKey === source.sourceKey).map((item) => ({
        kind: 'integration',
        key: item.key,
        title: item.title,
        subtitle: item.subtitle,
        body: item.body,
        providerLabel: item.providerLabel,
        toolkitId: item.toolkitId,
        connectionId: item.connectionId,
        accountId: item.accountId,
        accountLabel: item.accountLabel,
        sourceUrl: item.sourceUrl,
        due: item.due,
      })),
    };
  });
}

/** Filtering still names providers, with all their accounts underneath. */
export function integrationProviderScopes(result: IntegrationTaskResult | undefined) {
  return [...new Map((result?.sources ?? []).map((source) => [source.toolkitId, {
    toolkitId: source.toolkitId,
    providerLabel: source.providerLabel,
  }])).values()];
}
