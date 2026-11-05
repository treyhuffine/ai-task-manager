'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/lib/trpc/client';
import { toast } from 'sonner';
import type { RouterOutputs } from '@/lib/trpc/router';

export const coordinationKey = (sessionId: string) => ['coordination', sessionId] as const;
export function useCoordinationState(sessionId: string | null) {
  return useQuery({ queryKey: coordinationKey(sessionId ?? ''), queryFn: () => trpcClient.coordination.state.query({ sessionId: sessionId! }), enabled: !!sessionId, refetchInterval: 3000 });
}
export function useCoordinationHold(sessionId: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (held: boolean) => trpcClient.coordination.hold.mutate({ sessionId, held }),
    onMutate: async held => {
      await client.cancelQueries({ queryKey: coordinationKey(sessionId) });
      const previous = client.getQueryData<RouterOutputs['coordination']['state']>(coordinationKey(sessionId));
      if (previous) client.setQueryData(coordinationKey(sessionId), { ...previous, heldAt: held ? new Date().toISOString() : null });
      return { previous };
    },
    onError: (_error, _held, context) => {
      if (context?.previous) client.setQueryData<RouterOutputs['coordination']['state']>(coordinationKey(sessionId), current => current ? { ...current, heldAt: context.previous!.heldAt } : current);
      toast.error('Could not change incoming message pause. Try again.');
    },
    onSettled: () => { void client.invalidateQueries({ queryKey: coordinationKey(sessionId) }); },
  });
}
export function useCoordinationPolicy() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (input: Parameters<typeof trpcClient.coordination.policy.mutate>[0]) => trpcClient.coordination.policy.mutate(input),
    onMutate: async input => {
      await client.cancelQueries({queryKey:['coordination']});
      const previous = client.getQueriesData({queryKey:['coordination']});
      for (const [key,value] of previous) {
        if (!value || typeof value !== 'object') continue;
        if (key[1] === 'defaults' && input.scope === 'global') { client.setQueryData(key,{global:input.policy}); continue; }
        const state = value as RouterOutputs['coordination']['state'];
        if (!state.scopes || state.scopes[input.scope] !== input.id) continue;
        const levels = state.levels.map(level=>level.source===input.scope?{...level,value:input.policy}:level);
        const effective = levels.find(level=>level.value!=null);
        client.setQueryData(key,{...state,levels,policy:effective?.value??'ask',source:effective?.source??'default'});
      }
      return {previous};
    },
    onError: (error,input,context) => {
      for (const [key,value] of context?.previous??[]) {
        if (!value || typeof value !== 'object') continue;
        if (key[1] === 'defaults' && input.scope === 'global') {
          const previous = value as RouterOutputs['coordination']['defaults'];
          client.setQueryData<RouterOutputs['coordination']['defaults']>(key,current => current?.global === input.policy ? previous : current);
          continue;
        }
        const previous = value as RouterOutputs['coordination']['state'];
        if (!previous.scopes || previous.scopes[input.scope] !== input.id) continue;
        client.setQueryData<RouterOutputs['coordination']['state']>(key,current => {
          if (!current || current.levels.find(level=>level.source===input.scope)?.value !== input.policy) return current;
          const levels = current.levels.map(level=>level.source===input.scope ? {...level,value:previous.levels.find(old=>old.source===input.scope)?.value ?? null} : level);
          const effective = levels.find(level=>level.value!=null);
          return {...current,levels,policy:effective?.value??'ask',source:effective?.source??'default'};
        });
      }
      toast.error(error.message);
    },
    onSettled: () => { void client.invalidateQueries({ queryKey: ['coordination'] }); },
  });
}
export function useCoordinationDecision(sessionId: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (input: Parameters<typeof trpcClient.coordination.decide.mutate>[0]) => trpcClient.coordination.decide.mutate(input),
    onMutate: async input => {
      const key=['coordination-delivery',input.deliveryId];
      await client.cancelQueries({queryKey:key});
      const previous=client.getQueryData<RouterOutputs['coordination']['delivery']>(key);
      if(previous) client.setQueryData(key,{...previous,status:input.decision==='deny'?'denied':'queued'});
      const stateKey = coordinationKey(sessionId);
      await client.cancelQueries({queryKey:stateKey});
      const approval = client.getQueryData<RouterOutputs['coordination']['state']>(stateKey)?.approvals.find(item => item.id === input.deliveryId);
      client.setQueryData<RouterOutputs['coordination']['state']>(stateKey, current => current ? {...current, approvals:current.approvals.filter(item => item.id !== input.deliveryId)} : current);
      return {key,previous,approval};
    },
    onError: (error,_input,context) => {
      if(context?.previous) client.setQueryData(context.key,context.previous);
      if(context?.approval) client.setQueryData<RouterOutputs['coordination']['state']>(coordinationKey(sessionId), current => current && !current.approvals.some(item => item.id === context.approval!.id) ? {...current, approvals:[...current.approvals,context.approval!].sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))} : current);
      toast.error(error.message);
    },
    onSettled: (_data,_error,input) => { void client.invalidateQueries({queryKey:['coordination-delivery',input.deliveryId]}); void client.invalidateQueries({queryKey:coordinationKey(sessionId)}); },
  });
}
