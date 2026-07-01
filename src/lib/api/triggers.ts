/**
 * Typed client for the triggers + runs API.
 *
 * Routes proxy through to the orchestrator action layer on the server,
 * so behavior matches CLI + MCP exactly.
 */

import { api } from './client';
import type {
  TriggerRecord,
  CreateTriggerInput,
  UpdateTriggerInput,
  RunRecord,
  TriggerWithLastRun,
  RunStatus,
  RunTrigger,
} from '@/db/types';

export const triggersApi = {
  list(filter: {
    enabled?: boolean;
    workspaceId?: string | null;
    targetKind?: 'workspace' | 'orchestrator';
  } = {}): Promise<TriggerWithLastRun[]> {
    const query: Record<string, string> = {};
    if (filter.enabled !== undefined) query.enabled = String(filter.enabled);
    if (filter.workspaceId !== undefined) {
      query.workspaceId = filter.workspaceId === null ? 'null' : filter.workspaceId;
    }
    if (filter.targetKind) query.targetKind = filter.targetKind;
    return api.get<TriggerWithLastRun[]>('/triggers', { query });
  },
  get(id: string): Promise<TriggerRecord> {
    return api.get<TriggerRecord>(`/triggers/${id}`);
  },
  // `agentId` is optional on the wire — the create_trigger action
  // defaults it to the orchestrator/workspace agent when omitted. See
  // src/lib/orchestrator/registry.ts.
  create(input: Omit<CreateTriggerInput, 'agentId'> & { agentId?: string }): Promise<{
    trigger: TriggerRecord;
    webhookSecret?: string;
    webhookPublicId?: string;
  }> {
    return api.post('/triggers', input);
  },
  update(id: string, input: UpdateTriggerInput): Promise<TriggerRecord> {
    return api.patch<TriggerRecord>(`/triggers/${id}`, input);
  },
  delete(id: string): Promise<{ id: string; deleted: boolean }> {
    return api.delete(`/triggers/${id}`) as Promise<{ id: string; deleted: boolean }>;
  },
  run(id: string): Promise<{ run: RunRecord; chatSessionId: string | null }> {
    return api.post(`/triggers/${id}?action=run`, {});
  },
  resetFailures(id: string): Promise<TriggerRecord> {
    return api.post<TriggerRecord>(`/triggers/${id}?action=reset`, {});
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
  } = {}): Promise<RunRecord[]> {
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
    return api.get<RunRecord[]>('/runs', { query });
  },
  get(id: string): Promise<RunRecord> {
    return api.get<RunRecord>(`/runs/${id}`);
  },
  cancel(id: string): Promise<RunRecord> {
    return api.post<RunRecord>(`/runs/${id}?action=cancel`, {});
  },
};
