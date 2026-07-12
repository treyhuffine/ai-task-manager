'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Refresh rail-facing state when any session changes lifecycle, including
 * sessions whose detailed chat view is no longer mounted.
 */
export function useGlobalSessionStream(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource('/api/sessions/stream');
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', 'rail'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'needs-review'] });
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    };

    source.addEventListener('session_updated', refresh);
    source.addEventListener('ready', refresh);
    source.onerror = (err) => {
      console.warn('[useGlobalSessionStream] stream error:', err);
    };

    return () => {
      source.removeEventListener('session_updated', refresh);
      source.removeEventListener('ready', refresh);
      source.close();
    };
  }, [queryClient]);
}
