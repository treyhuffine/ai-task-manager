'use client';

import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/lib/trpc/client';
import { KEY } from './app-hooks';

/** The app's build and runtime output, a bounded strip under the header. Polls while a build runs. */
export function AppOutput({ id, draft, live = false }: { id: string; draft: boolean; live?: boolean }) {
  const log = useQuery({
    queryKey: [...KEY, 'log', id, draft],
    queryFn: () => trpcClient.localApps.log.query({ id, draft }),
    refetchInterval: live ? 2000 : false,
  });
  return (
    <pre
      aria-label="App output"
      className="max-h-40 flex-shrink-0 overflow-auto whitespace-pre-wrap border-b border-border bg-muted/20 px-4 py-2 font-mono text-[10.5px] leading-snug text-muted-foreground"
    >
      {log.error?.message ?? log.data?.text ?? 'Loading app output'}
    </pre>
  );
}
