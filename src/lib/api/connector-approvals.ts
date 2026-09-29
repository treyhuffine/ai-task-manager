import { api } from './client';

/** What the user chose on a connector approval card (mirrors `ApprovalDecision` server-side). */
export type ConnectorApprovalDecision = 'approve' | 'always' | 'deny';

export interface ResolveConnectorApprovalsResult {
  ok: true;
  decision: ConnectorApprovalDecision;
  /** Ids this call resolved. */
  resolved: string[];
  /** Ids that were no longer pending (resolved elsewhere, or lost to a restart). */
  missing: string[];
}

export const connectorApprovalsApi = {
  /** Ids of this chat's connector approvals still waiting on the user. */
  live: async (sessionId: string): Promise<string[]> => {
    const data = await api.get<{ pending: { id: string }[] }>(
      `/connectors/pending-approvals?sessionId=${encodeURIComponent(sessionId)}`,
    );
    return (data?.pending ?? []).map((p) => p.id);
  },

  resolve: (ids: string[], decision: ConnectorApprovalDecision) =>
    api.post<ResolveConnectorApprovalsResult>('/connectors/approve', { ids, decision }),
};
