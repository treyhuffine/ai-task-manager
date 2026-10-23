import { teamCapabilities } from '@/lib/team/capabilities';
import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HomeBoundary } from '@/components/home/home-context';
import { trpc } from '@/lib/trpc/client';
import { event } from './gallery/fixtures';
import { toChatEventDTO } from '@/lib/api/dto/chat-event';
import { ChatAudience, TeamTurnControls, useMemberMessageHeader } from './member-attribution';

const user = toChatEventDTO(event('user', { authorMemberId: 'former-member', role: 'user' }));
const assistant = toChatEventDTO(event('agent', { authorMemberId: 'former-member' }));
const unknown = toChatEventDTO(event('user', { id: 'unknown-member', role: 'user', authorMemberId: null }));
function AttributedChat() {
  const header = useMemberMessageHeader([user, assistant, unknown]);
  return <><ChatAudience />{header(user)}{header(assistant)}{header(unknown)}</>;
}

it.each(['team', 'personal'] as const)('uses the authenticated %s audience and keeps former member names in shared history', kind => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  cache.setQueryData(trpc.homeContext.queryKey(), {
    home: { id: 'home', kind, name: 'Acme' }, viewer: { id: 'member', name: 'Maya', role: kind === 'team' ? 'member' : 'personal' }, executionChoices: [],
    capabilities: { ...teamCapabilities({ role: 'member', status: 'active' }), editContent: true, deletePermanently: false, administerMembers: false, privatePlanning: kind === 'personal', configureAgents: false },
  });
  cache.setQueryData(trpc.team.members.queryKey(), [{ id: 'former-member', name: 'Sam Former', role: 'member', active: false }]);
  const html = renderToStaticMarkup(<QueryClientProvider client={cache}><HomeBoundary><AttributedChat /></HomeBoundary></QueryClientProvider>);
  if (kind === 'team') {
    expect(html).toContain('Everyone in Acme can read this chat.');
    expect(html.match(/Sam Former/g)).toHaveLength(1);
    expect(html).toContain('Someone who left');
  } else expect(html).toBe('');
  cache.clear();
});


it.each([
  ['queued', null, 'Queued', 'Cancel queued message'],
  ['failed', 'Provider timed out. Send again when ready.', 'Provider timed out.', 'Send again'],
  ['cancelled', 'Cancelled by Sam.', 'Cancelled by Sam.', 'Send again'],
  ['interrupted', 'The server restarted.', 'The server restarted.', 'Send again'],
] as const)('shows the %s receipt and its ordinary transcript control', (status, error, reason, action) => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const html = renderToStaticMarkup(<QueryClientProvider client={cache}><TeamTurnControls sessionId="chat" message={user} turn={{ id:'turn',messageEventId:user.id,memberId:'member',status,error }}/></QueryClientProvider>);
  expect(html).toContain(reason);
  expect(html).toContain(action);
  expect(html).not.toContain('Stopped');
  cache.clear();
});

it('does not invent the creator of a retained legacy chat', () => {
  const cache = new QueryClient();
  const html = renderToStaticMarkup(<QueryClientProvider client={cache}><ChatAudience name="Acme" createdByMemberId={null}/></QueryClientProvider>);
  expect(html).toContain('Creator not recorded.');
  cache.clear();
});
