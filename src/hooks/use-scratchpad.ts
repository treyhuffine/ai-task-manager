'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc/client';
import { documentSaves } from '@/lib/client/document-saves';
import { ScratchpadSaver, type ScratchpadSaveResult } from '@/lib/client/scratchpad-saver';

/** Another device's writes show up within this long while the pad is open, and at once on coming back to the window. */
const REFRESH_MS = 30_000;

/**
 * The scratchpad's text and its saver for one open editor (docs/scratchpad.md).
 * The saver owns what the editor shows. The query only tells it what the
 * server holds now, so a refetch never replaces typing that isn't sent.
 */
export function useScratchpad() {
  const query = useQuery({
    ...trpc.scratchpad.get.queryOptions(),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: REFRESH_MS,
  });
  // mutateAsync belongs to the mutation's observer, the same function on every render.
  const { mutateAsync } = useMutation(trpc.scratchpad.save.mutationOptions({ meta: { carriesInput: true } }));
  const [saver] = useState(() => new ScratchpadSaver(
    (input) => mutateAsync(input) as Promise<ScratchpadSaveResult>,
    () => window.localStorage,
  ));
  const snapshot = useSyncExternalStore(saver.subscribe, saver.snapshot, saver.snapshot);

  useEffect(() => {
    if (query.data !== undefined) saver.observe(query.data);
  }, [saver, query.data]);

  // Coming back from another app leaves the page visible, so the query's own
  // refetch (on visibility) misses it. A pad you return to should be current.
  const { refetch } = query;
  useEffect(() => {
    const onFocus = () => { void refetch(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refetch]);

  // Leaving the page, a version reload or quitting the desktop app waits on
  // what's unsent here, like a note's body. Closing the pad sends it.
  useEffect(() => {
    const unregister = documentSaves.register(saver);
    const detach = saver.attach();
    return () => { unregister(); detach(); };
  }, [saver]);

  return { saver, snapshot, loadError: snapshot.ready ? null : query.error, retry: () => void refetch() };
}
