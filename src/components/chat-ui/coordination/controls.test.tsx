import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatCapabilities } from '../chat-capabilities';
import { CoordinationControls, CoordinationSettings } from './controls';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { coordinationKey } from '@/hooks/use-coordination';
import { coordinationDeliveryExample } from '../gallery/fixtures';
import { TipProvider } from '@/components/ui/tip';

it.each([CoordinationControls, CoordinationSettings])('keeps personal coordination out of shared chats (%s)', Component => {
  // Deliberately omit a query provider. Disabled controls must not mount
  // personal data hooks, including when their surrounding menu is open.
  const html = renderToStaticMarkup(
    <ChatCapabilities.Provider value={{ deliveryReceipts: false, prepareResults: true, coordination: false }}>
      <Component sessionId="shared-chat" />
    </ChatCapabilities.Provider>,
  );
  expect(html).toBe('');
});

it.each([true, false])('shows server-owned manager authority without ineffective choices (unrestricted=%s)', unrestricted => {
  const cache = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  cache.setQueryData(coordinationKey('chat'), {
    unrestricted, policy: 'ask', source: 'chat', levels: [{ source: 'chat', value: 'ask' }],
    scopes: { chat: 'chat', execution: null, agent: null, global: '1' }, heldAt: null, approvals: [],
  });
  const html = renderToStaticMarkup(<QueryClientProvider client={cache}><TipProvider><CoordinationSettings sessionId="chat" /></TipProvider></QueryClientProvider>);
  expect(html.includes('Manager chats are unrestricted.')).toBe(unrestricted);
  expect(html.includes('aria-label="Coordination for chat"')).toBe(!unrestricted);
  expect(html.includes('Ask first')).toBe(!unrestricted);
  expect(html).toContain('Pause incoming');
  cache.clear();
});

it.each([CoordinationControls, CoordinationSettings])('keeps an old pending approval actionable without loading its transcript (%s)', Component => {
  const cache = new QueryClient({defaultOptions:{queries:{staleTime:Infinity,retry:false}}});
  cache.setQueryData(coordinationKey('chat'), {
    unrestricted:false,policy:'ask',source:'chat',levels:[{source:'chat',value:'ask'}],
    scopes:{chat:'chat',execution:null,agent:null,global:'1'},heldAt:null,
    active:{starting:false,chatIds:[],assignmentsWaiting:0},pending:0,
    approvals:[{...coordinationDeliveryExample('approval'),targetSessionId:null,targetAddress:'agent:research',destinationName:'Research',launchOptions:null}],
  });
  const html=renderToStaticMarkup(<QueryClientProvider client={cache}><TipProvider><Component sessionId="chat" /></TipProvider></QueryClientProvider>);
  expect(html).toContain('aria-label="Pending coordination approvals"');
  expect(html).toContain('Review the date boundary handling before we ship.');
  for (const button of ['Approve','Always','Decline']) expect(html).toContain(`>${button}</button>`);
  expect(html).not.toContain('Incoming agent messages waiting');
  cache.clear();
});
