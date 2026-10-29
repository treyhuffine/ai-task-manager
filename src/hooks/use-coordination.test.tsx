import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { coordinationKey, useCoordinationDecision } from './use-coordination';
import { coordinationDeliveryExample } from '@/components/chat-ui/gallery/fixtures';
import type { RouterOutputs } from '@/lib/trpc/router';
const transport=vi.hoisted(()=>({decide:vi.fn()}));
vi.mock('@/lib/trpc/client',()=>({trpcClient:{coordination:{decide:{mutate:transport.decide}}}}));
vi.mock('sonner',()=>({toast:{error:vi.fn()}}));
it('restores the pending approval after a failed decision without undoing a concurrent incoming pause',async()=>{
  const client=new QueryClient({defaultOptions:{mutations:{retry:false}}});
  const approval={...coordinationDeliveryExample('approval'),destinationName:null,launchOptions:null};
  type State=Pick<RouterOutputs['coordination']['state'],'approvals'|'heldAt'>;
  client.setQueryData<State>(coordinationKey('chat'),{approvals:[approval],heldAt:null});
  const capture=vi.fn<(value:ReturnType<typeof useCoordinationDecision>)=>void>();
  function Hook(){capture(useCoordinationDecision('chat'));return null;}
  renderToStaticMarkup(<QueryClientProvider client={client}><Hook /></QueryClientProvider>);
  const decision=capture.mock.calls[0][0];
  let reject!: (error:Error)=>void;
  transport.decide.mockImplementation(()=>new Promise((_resolve,fail)=>{reject=fail;}));
  const pending=decision.mutateAsync({deliveryId:approval.id,decision:'allow'});
  await vi.waitFor(()=>expect(client.getQueryData<State>(coordinationKey('chat'))?.approvals).toEqual([]));
  client.setQueryData<State>(coordinationKey('chat'),current=>({...current!,heldAt:'2026-10-29T15:00:00.000Z'}));
  reject(new Error('Connection lost.'));
  await expect(pending).rejects.toThrow('Connection lost.');
  expect(client.getQueryData<State>(coordinationKey('chat'))).toEqual({approvals:[approval],heldAt:'2026-10-29T15:00:00.000Z'});
  client.clear();
});
