import type {
	CreateStreamInput,
	StreamAutonomyConfig,
	StreamAutonomyLevel,
	StreamFilter,
	TriageDecisionRecord,
	TriageDisposition,
	TriageDraft,
	TriagePassRecord
} from '@/db/types';
import { trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';

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
  list(filter?: StreamFilter) {
    return trpcClient.stream.list.query({query: rpcQuery(filter as Record<string, string>)});
  },

  create(input: CreateStreamInput) {
    return trpcClient.stream.create.mutate({body: input});
  },

  dismiss(id: string) {
    return trpcClient.stream.dismissPost.mutate({params: {id: id}, body: {}});
  },

  reopen(id: string) {
    return trpcClient.stream.reopenPost.mutate({params: {id: id}, body: {}});
  },

  retry(id: string) {
    return trpcClient.stream.retryPost.mutate({params: {id: id}, body: {}});
  },

  /** Manual triage: applied immediately as the user's own decision. */
  decide(input: ManualTriageInput) {
    return trpcClient.stream.decisionsPost.mutate({body: input});
  },

  listDecisions(params?: { state?: string; passId?: string }) {
    return trpcClient.stream.decisionsGet.query({query: rpcQuery(params as Record<string, string>)});
  },

  acceptDecision(id: string) {
    return trpcClient.stream.decisionsAcceptPost.mutate({params: {id: id}, body: {}});
  },

  correctDecision(id: string, correction: TriageCorrectionInput) {
    return trpcClient.stream.decisionsCorrectPost.mutate({params: {id: id}, body: correction});
  },

  undoDecision(id: string) {
    return trpcClient.stream.decisionsUndoPost.mutate({params: {id: id}, body: {}});
  },

  /** Kick a sweep session immediately (the Triage button). */
  triage() {
    return trpcClient.stream.triagePost.mutate({body: {}});
  },

  passes(limit = 10) {
    return trpcClient.stream.passesGet.query({query: rpcQuery({ limit: String(limit) })});
  },

  markPassSeen(id: string) {
    return trpcClient.stream.passesSeenPost.mutate({params: {id: id}, body: {}});
  },

  autonomy() {
    return trpcClient.stream.autonomyGet.query({});
  },

  setAutonomy(config: StreamAutonomyConfig & { mode?: StreamAutomationMode }) {
    return trpcClient.stream.autonomyPut.mutate({body: config});
  },
};
