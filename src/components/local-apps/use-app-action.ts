'use client';

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KEY } from './app-hooks';

/**
 * Runs one app operation at a time: a toast on failure, the registry
 * refreshed on success, and `busy` while it runs so buttons don't fire twice.
 */
export function useAppAction() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (operation: () => Promise<unknown>, failure = 'App operation failed'): Promise<boolean> => {
      setBusy(true);
      try {
        await operation();
        await qc.invalidateQueries({ queryKey: KEY });
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : failure);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [qc],
  );
  return { busy, run };
}
