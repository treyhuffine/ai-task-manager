/** Main-chat ownership is a Home policy. Lifecycle and persistence remain common. */
import { actorFromRequestKey } from '@/lib/auth/actor';
import * as q from '@/lib/db/queries';
import { authorizeTeamExecution } from '@/lib/home/execution-authority';
import { executionRequestKey } from '@/lib/home/execution-request';

import { executionStartPolicy } from './home-policy';
import type { ChatOverride, MainChatScope } from './main-chat';

export function mainChatAuthority(scope: MainChatScope, operation: 'read' | 'start' = 'read') {
  if (q.getHome()?.kind !== 'team') return null;
  if (!scope) throw new q.TeamError('not_allowed', 'Choose a shared team agent for this chat.');
  return authorizeTeamExecution(executionRequestKey(), { workspaceId: scope, operation });
}

export async function mainChatStartPolicy(scope: MainChatScope, override: ChatOverride) {
  const authority = mainChatAuthority(scope, 'start');
  if (!authority) return null;
  const preferred = q.getTeamAiSettings();
  const defaultHarness = preferred?.harness;
  const harness = override.providerId ?? defaultHarness;
  const key = executionRequestKey()!;
  const policy = await executionStartPolicy(authority.workspace!, {
    harness, model: override.model ?? (harness === defaultHarness ? preferred?.model : undefined), modelVariant: override.variant, effort: override.effort, serviceTier: override.serviceTier,
    actor: actorFromRequestKey(key),
  });
  return { ...policy, deviceId: q.getHome()!.hostDeviceId };
}

