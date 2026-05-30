/**
 * Typed client for the schedules + runs API.
 *
 * Routes proxy through to the orchestrator action layer on the server,
 * so behavior matches CLI + MCP exactly.
 */

import { api } from './client';
import type {
  ScheduleRecord,
  CreateScheduleInput,
  UpdateScheduleInput,
  RunRecord,
  ScheduleWithLastRun,
  RunStatus,
  RunTrigger,
} from '@/db/types';

export const schedulesApi = {
  list(filter: {
    enabled?: boolean;
    workspaceId?: string | null;
    targetKind?: 'workspace' | 'orchestrator';
  } = {}): Promise<ScheduleWithLastRun[]> {
    const query: Record<string, string> = {};
    if (filter.enabled !== undefined) query.enabled = String(filter.enabled);
    if (filter.workspaceId !== undefined) {
      query.workspaceId = filter.workspaceId === null ? 'null' : filter.workspaceId;
    }
    if (filter.targetKind) query.targetKind = filter.targetKind;
    return api.get<ScheduleWithLastRun[]>('/schedules', { query });
  },
  get(id: string): Promise<ScheduleRecord> {
    return api.get<ScheduleRecord>(`/schedules/${id}`);
  },
  // `agentId` is optional on the wire — the create_schedule action
  // defaults it to the orchestrator/workspace agent when omitted. See
  // src/lib/orchestrator/registry.ts.
  create(input: Omit<CreateScheduleInput, 'agentId'> & { agentId?: string }): Promise<{
    schedule: ScheduleRecord;
    webhookSecret?: string;
    webhookPublicId?: string;
  }> {
    return api.post('/schedules', input);
  },
  update(id: string, input: UpdateScheduleInput): Promise<ScheduleRecord> {
    return api.patch<ScheduleRecord>(`/schedules/${id}`, input);
  },
  delete(id: string): Promise<{ id: string; deleted: boolean }> {
    return api.delete(`/schedules/${id}`) as Promise<{ id: string; deleted: boolean }>;
  },
  run(id: string): Promise<{ run: RunRecord; chatSessionId: string | null }> {
    return api.post(`/schedules/${id}?action=run`, {});
  },
  resetFailures(id: string): Promise<ScheduleRecord> {
    return api.post<ScheduleRecord>(`/schedules/${id}?action=reset`, {});
  },
};

export const runsApi = {
  list(filter: {
    status?: RunStatus | RunStatus[];
    trigger?: RunTrigger | RunTrigger[];
    scheduleId?: string;
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
    if (filter.scheduleId) query.scheduleId = filter.scheduleId;
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
