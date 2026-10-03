'use client';

import { DISCOVERY_KEY } from '@/components/settings/sections/imports-section';
import { apiErrorText } from '@/lib/api/client';
import { trpcClient } from '@/lib/trpc/client';
import { rpcOptions } from '@/lib/trpc/request-options';
import type { QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { listJoin } from './onboarding-flow';

/**
 * An import started from the first run, carried on in the background. Bringing
 * in a project's chats can take minutes, and the conversation shouldn't wait
 * on it: the step hands the work here and moves on. Module-level, outside any
 * component, so leaving the chat (or finishing the conversation) never drops
 * it. The conversation shows its progress, and a toast says when it's done.
 */
export interface ImportRun {
  status: 'running' | 'done' | 'failed';
  projects: string[];
  /** Chats asked for. */
  chats: number;
  /** Chats brought in, once done. */
  imported?: number;
  error?: string;
}

let run: ImportRun | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function set(next: ImportRun) {
  run = next;
  emit();
}

const plural = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;

export function startImport(qc: QueryClient, input: { sessionKeys: string[]; projects: string[] }): void {
  if (run?.status === 'running' || input.sessionKeys.length === 0) return;
  set({ status: 'running', projects: input.projects, chats: input.sessionKeys.length });
  trpcClient.imports.agentsPost.mutate({body: { sessionKeys: input.sessionKeys }}, rpcOptions({ timeoutMs: 30 * 60_000 }))
    .then(async (result) => {
      const imported = result.importedSessions + result.syncedSessions;
      set({ status: 'done', projects: input.projects, chats: input.sessionKeys.length, imported });
      toast.success(`Brought in ${plural(imported, 'chat')}`, { description: `From ${listJoin(input.projects)}` });
      await Promise.all([
        qc.invalidateQueries({ queryKey: DISCOVERY_KEY }),
        qc.invalidateQueries({ queryKey: ['workspaces'] }),
        qc.invalidateQueries({ queryKey: ['sessions', 'rail'] }),
      ]);
    })
    .catch((err) => {
      const error = apiErrorText(err);
      set({ status: 'failed', projects: input.projects, chats: input.sessionKeys.length, error });
      toast.error('Couldn’t bring those chats in', { description: error });
    });
}

export function useImportRun(): ImportRun | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => run,
    () => null,
  );
}
