import { api } from './client';
import type {
  StreamRecord,
  StreamRecordWithOutcomes,
  CreateStreamInput,
  StreamFilter,
  TriageDecisionRecord,
  TriagePassRecord,
  TriageDisposition,
  TriageDraft,
  StreamAutonomyConfig,
  StreamAutonomyLevel,
} from '@/db/types';

/** Source-capture preview embedded in decision/pass payloads. */
export interface TriageDecisionItemPreview {
  id: string;
  rawText: string;
  createdAt: string;
  media: string;
  status: string;
}

export type TriageDecisionWithItems = TriageDecisionRecord & {
  items: TriageDecisionItemPreview[];
  targetTitle: string | null;
};

export type TriagePassWithDecisions = TriagePassRecord & {
  decisions: TriageDecisionWithItems[];
};

export interface ManualTriageInput {
  disposition: TriageDisposition;
  streamItemIds: string[];
  targetType?: 'task' | 'note' | null;
  targetId?: string | null;
  draft?: TriageDraft | null;
}

export interface TriageCorrectionInput {
  disposition: TriageDisposition;
  targetType?: 'task' | 'note' | null;
  targetId?: string | null;
  draft?: TriageDraft | null;
}

export type StreamAutomationMode = 'handle_obvious' | 'review_everything' | 'manual_only';

export interface StreamAutonomyState {
  autonomy: { killSwitch: boolean; levels: Record<TriageDisposition, StreamAutonomyLevel> };
  mode: StreamAutomationMode;
  offers: Array<{
    disposition: TriageDisposition;
    action: string;
    fromLevel: StreamAutonomyLevel;
    toLevel: StreamAutonomyLevel;
    rate: number | null;
    sample: number;
    /** Server-composed, user-facing offer copy. */
    line: string;
  }>;
}

export const streamApi = {
  list(filter?: StreamFilter): Promise<StreamRecordWithOutcomes[]> {
    return api.get<StreamRecordWithOutcomes[]>('/stream', { query: filter as Record<string, string> });
  },

  create(input: CreateStreamInput): Promise<StreamRecord> {
    return api.post<StreamRecord>('/stream', input);
  },

  dismiss(id: string): Promise<unknown> {
    return api.post(`/stream/${id}/dismiss`, {});
  },

  reopen(id: string): Promise<StreamRecord> {
    return api.post<StreamRecord>(`/stream/${id}/reopen`, {});
  },

  retry(id: string): Promise<{ item: StreamRecord }> {
    return api.post<{ item: StreamRecord }>(`/stream/${id}/retry`, {});
  },

  /** Manual triage: applied immediately as the user's own decision. */
  decide(input: ManualTriageInput): Promise<unknown> {
    return api.post('/stream/decisions', input);
  },

  listDecisions(params?: { state?: string; passId?: string }): Promise<TriageDecisionWithItems[]> {
    return api.get<TriageDecisionWithItems[]>('/stream/decisions', {
      query: params as Record<string, string>,
    });
  },

  acceptDecision(id: string): Promise<unknown> {
    return api.post(`/stream/decisions/${id}/accept`, {});
  },

  correctDecision(id: string, correction: TriageCorrectionInput): Promise<unknown> {
    return api.post(`/stream/decisions/${id}/correct`, correction);
  },

  undoDecision(id: string): Promise<unknown> {
    return api.post(`/stream/decisions/${id}/undo`, {});
  },

  /** Kick a sweep session immediately (the Triage button). */
  triage(): Promise<{ started: boolean; reason?: string }> {
    return api.post<{ started: boolean; reason?: string }>('/stream/triage', {});
  },

  passes(limit = 10): Promise<TriagePassWithDecisions[]> {
    return api.get<TriagePassWithDecisions[]>('/stream/passes', { query: { limit: String(limit) } });
  },

  markPassSeen(id: string): Promise<TriagePassRecord> {
    return api.post<TriagePassRecord>(`/stream/passes/${id}/seen`, {});
  },

  autonomy(): Promise<StreamAutonomyState> {
    return api.get<StreamAutonomyState>('/stream/autonomy');
  },

  setAutonomy(config: StreamAutonomyConfig & { mode?: StreamAutomationMode }): Promise<unknown> {
    return api.put('/stream/autonomy', config);
  },
};
