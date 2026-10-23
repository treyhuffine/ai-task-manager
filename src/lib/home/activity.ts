import type { CreateTeamActivityInput, MemberRecord } from '@/db/types';
import { recordTeamActivity } from '@/lib/db/queries';
import { executionRequestKey } from './execution-request';

/** The operation carries the authority it resolved before doing work. */
export function recordHomeActivity(authority: { member: Pick<MemberRecord, 'id'>; workspace: { id: string } | null } | null, operation: string, resource: string, kind: CreateTeamActivityInput['kind'] = 'preview_change') {
  if (!authority?.workspace) return;
  const key = executionRequestKey();
  if (!key) throw new Error('An attributed Team operation requires its request authority.');
  recordTeamActivity({ workspaceId: authority.workspace.id, memberId: authority.member.id,
    apiKeyId: key.apiKeyId, operation, resource, kind });
}
