import { decideHubApproval, deniedHubApproval, dropHubApprovals, insertHubApproval, listPendingHubApprovals, takeHubApprovalGrant } from '@/lib/db/queries';
import type { HubApprovalStore, StoredHubApproval } from '../approval';

/**
 * Apps' approval requests in `hub_approvals` (docs/personal-apps.md "The hub"), so a request and
 * its 24-hour approval survive a restart of Ri, and its ID stays the one the app was given.
 */
export const hubApprovalStore: HubApprovalStore = {
  insertPending(request) {
    insertHubApproval({
      id: request.id, appId: request.appId, callKey: request.callKey, actionId: request.actionId, connectionId: request.connectionId,
      ownerId: request.ownerId, providerId: request.providerId, risk: request.risk, preview: request.preview, account: request.account,
      sessionId: request.sessionId, startedBy: request.startedBy, createdAt: new Date(request.createdAt).toISOString(),
    });
  },
  listPending(): StoredHubApproval[] {
    return listPendingHubApprovals().map((row) => ({
      id: row.id, appId: row.appId, callKey: row.callKey, actionId: row.actionId, connectionId: row.connectionId,
      ownerId: row.ownerId, providerId: row.providerId, risk: row.risk, preview: row.preview, account: row.account,
      sessionId: row.sessionId, startedBy: row.startedBy, createdAt: Date.parse(row.createdAt),
    }));
  },
  decide(id, decision, expiresAt) {
    decideHubApproval(id, decision, expiresAt === null ? null : new Date(expiresAt).toISOString());
  },
  takeGrant(appId, callKey, now) {
    return takeHubApprovalGrant(appId, callKey, new Date(now).toISOString());
  },
  deniedSince(appId, callKey, since) {
    return deniedHubApproval(appId, callKey, new Date(since).toISOString());
  },
  drop(appId, connectionId) {
    dropHubApprovals(appId, connectionId);
  },
};
