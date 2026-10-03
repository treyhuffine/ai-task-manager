import { trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';
import type { RouterOutputs } from '@/lib/trpc/router';

/** What the user chose on a connector approval card (mirrors `ApprovalDecision` server-side). */
export type ConnectorApprovalDecision = 'approve' | 'always' | 'deny';

export type ResolveConnectorApprovalsResult = RouterOutputs['connectors']['approvePost'];

export const connectorApprovalsApi = {
  /** Ids of this chat's connector approvals still waiting on the user. */
  live: async (sessionId: string): Promise<string[]> => {
    const data = await trpcClient.connectors.pendingApprovalsGet.query({query: rpcQuery({"sessionId": sessionId})});
    return (data?.pending ?? []).map((p) => p.id);
  },

  resolve: (ids: string[], decision: ConnectorApprovalDecision) =>
    trpcClient.connectors.approvePost.mutate({body: { ids, decision }}),
};
