'use client';
import {createTRPCClient,httpBatchLink} from '@trpc/client';
import {createTRPCOptionsProxy} from '@trpc/tanstack-react-query';
import {QueryClient} from '@tanstack/react-query';
import type {AppRouter} from './router';
export const queryClient=new QueryClient({defaultOptions:{queries:{staleTime:15000,retry:1}}});
export const trpcClient=createTRPCClient<AppRouter>({links:[httpBatchLink({url:'/api/trpc'})]});
export const trpc=createTRPCOptionsProxy<AppRouter>({client:trpcClient,queryClient});
