import { trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';
import type { RouterOutputs } from '@/lib/trpc/router';

/** What the user chose on an integration approval card (mirrors `ApprovalDecision` server-side). */
export type IntegrationApprovalDecision = 'approve' | 'always' | 'deny';

export type ResolveIntegrationApprovalsResult = RouterOutputs['integrations']['approvePost'];

export const integrationApprovalsApi = {
  /** Ids of this chat's integration approvals still waiting on the user. */
  live: async (sessionId: string): Promise<string[]> => {
    const data = await trpcClient.integrations.pendingApprovalsGet.query({query: rpcQuery({"sessionId": sessionId})});
    return (data?.pending ?? []).map((p) => p.id);
  },

  resolve: (ids: string[], decision: IntegrationApprovalDecision) =>
    trpcClient.integrations.approvePost.mutate({body: { ids, decision }}),
};
