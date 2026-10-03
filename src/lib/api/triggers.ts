import { trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';
/**
 * Typed client for the triggers + runs API.
 *
 * Routes proxy through to the orchestrator action layer on the server,
 * so behavior matches CLI + MCP exactly.
 */

import type {
	CreateTriggerInput,
	RunStatus,
	RunTrigger,
	UpdateTriggerInput
} from '@/db/types';
import type { ProviderId } from '@/lib/harness/options';

/**
 * The wire picks the engine by `provider`. The create_trigger action stores it
 * as the row's `harness`, defaulting to the user's default provider. See
 * src/lib/orchestrator/registry.ts.
 */
export type CreateTriggerPayload = Omit<CreateTriggerInput, 'harness'> & {
  provider?: ProviderId;
};

/** A provider switch resets model and effort unless the same patch sets them. */
export type UpdateTriggerPayload = Omit<UpdateTriggerInput, 'harness'> & { provider?: ProviderId };

export const triggersApi = {
  list(filter: {
    enabled?: boolean;
    workspaceId?: string | null;
    targetKind?: 'workspace' | 'orchestrator';
  } = {}) {
    const query: Record<string, string> = {};
    if (filter.enabled !== undefined) query.enabled = String(filter.enabled);
    if (filter.workspaceId !== undefined) {
      query.workspaceId = filter.workspaceId === null ? 'null' : filter.workspaceId;
    }
    if (filter.targetKind) query.targetKind = filter.targetKind;
    return trpcClient.triggers.list.query({ query });
  },
  get(id: string) {
    return trpcClient.triggers.get.query({params: {id: id}});
  },
  create(input: CreateTriggerPayload) {
    return trpcClient.triggers.create.mutate({body: input});
  },
  update(id: string, input: UpdateTriggerPayload) {
    return trpcClient.triggers.update.mutate({params: {id: id}, body: input});
  },
  delete(id: string) {
    return trpcClient.triggers.delete.mutate({params: {id: id}});
  },
  run(id: string) {
    return trpcClient.triggers.action.mutate({params: {id: id}, query: rpcQuery({"action": "run"}), body: {}});
  },
  resetFailures(id: string) {
    return trpcClient.triggers.action.mutate({params: {id: id}, query: rpcQuery({"action": "reset"}), body: {}});
  },
};

export const runsApi = {
  list(filter: {
    status?: RunStatus | RunStatus[];
    trigger?: RunTrigger | RunTrigger[];
    triggerId?: string;
    executionId?: string;
    workspaceId?: string;
    since?: string;
    limit?: number;
  } = {}) {
    const query: Record<string, string> = {};
    if (filter.status) {
      query.status = Array.isArray(filter.status) ? filter.status.join(',') : filter.status;
    }
    if (filter.trigger) {
      query.trigger = Array.isArray(filter.trigger) ? filter.trigger.join(',') : filter.trigger;
    }
    if (filter.triggerId) query.triggerId = filter.triggerId;
    if (filter.executionId) query.executionId = filter.executionId;
    if (filter.workspaceId) query.workspaceId = filter.workspaceId;
    if (filter.since) query.since = filter.since;
    if (filter.limit) query.limit = String(filter.limit);
    return trpcClient.runs.list.query({ query });
  },
  get(id: string) {
    return trpcClient.runs.get.query({params: {id: id}});
  },
  cancel(id: string) {
    return trpcClient.runs.create.mutate({params: {id: id}, query: rpcQuery({"action": "cancel"}), body: {}});
  },
};
