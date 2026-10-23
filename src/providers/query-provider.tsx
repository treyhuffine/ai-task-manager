'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query/client';
import { useState, type ReactNode } from 'react';
import { trpc } from '@/lib/trpc/client';
import type { HomeContext } from '@/lib/home/context';

export function QueryProvider({ children, initialHomeContext }: { children: ReactNode; initialHomeContext?: HomeContext }) {
  const [queryClient] = useState(() => {
    const client = getQueryClient();
    if (initialHomeContext) client.setQueryData(trpc.homeContext.queryKey(), initialHomeContext);
    return client;
  });

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
