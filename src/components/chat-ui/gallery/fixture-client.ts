/** This module replaces the production tRPC client only in the generated gallery iframe bundle. */
import { createTRPCClient, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { QueryClient } from '@tanstack/react-query';
import type { AppRouter } from '@/lib/trpc/router';
import { galleryExample, type ChatUiExampleId } from './catalog';
import { GalleryRuntime } from './runtime';

declare const __GALLERY_MCP_RESOURCE__: unknown;
const params = new URLSearchParams(window.location.hash.slice(1));
const example = galleryExample(params.get('example'));
export const fixtureConfig = { example: example.id as ChatUiExampleId, state: example.states.some(state => state.id === params.get('state')) ? params.get('state')! : example.states[0].id, theme: params.get('theme') === 'dark' ? 'dark' : 'light' };
export const fixtureRuntime = new GalleryRuntime(fixtureConfig.example, fixtureConfig.state, __GALLERY_MCP_RESOURCE__);
export const fixtureQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false }, mutations: { retry: false } } });

const link: TRPCLink<AppRouter> = () => ({ op }) => observable(observer => {
  let cancelled = false;
  void fixtureRuntime.invoke(op.path, op.input).then(data => {
    if (!cancelled) { observer.next({ result: { data } }); observer.complete(); }
  }).catch(error => {
    if (error instanceof Error && error.message.startsWith('The gallery has no fixture')) parent.postMessage({ type: 'ri-chat-gallery-diagnostic', message: error.message }, '*');
    if (!cancelled) observer.error(error);
  });
  return () => { cancelled = true; };
});
export const trpcClient = createTRPCClient<AppRouter>({ links: [link] });
export const terminalTRPCClient = trpcClient;
export const trpc = createTRPCOptionsProxy<AppRouter>({ client: trpcClient, queryClient: () => fixtureQueryClient });
