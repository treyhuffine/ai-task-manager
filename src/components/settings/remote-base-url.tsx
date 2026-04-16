'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Check, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { settingsApi } from '@/lib/api/settings';
import { APP_SHORT_ID } from '@/constants/app';

/**
 * CRUD for the remote base URL stored in ~/.<APP_SHORT_ID>/config.json.
 * This is the hostname new device pairing URLs will be built against so
 * remote/off-network devices can reach this host.
 */
export function RemoteBaseUrlSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'base-url'],
    queryFn: () => settingsApi.getBaseUrls(),
  });

  const saved = data?.tunnel ?? null;
  const [draftOverride, setDraftOverride] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const draft = draftOverride ?? saved ?? '';

  const saveMutation = useMutation({
    mutationFn: (value: string | null) => settingsApi.setTunnelUrl(value),
    onSuccess: (res) => {
      queryClient.setQueryData(['settings', 'base-url'], res);
      setDraftOverride(null);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    },
  });

  const dirty = (draft.trim() || null) !== saved;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Globe size={14} className="text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">Remote base URL</h3>
      </div>
      <p className="text-[11px] text-muted-foreground/70">
        The hostname off-network devices use to reach this host (e.g. your tunnel URL).
        Used when generating new device pairing URLs.
      </p>

      <div className="flex items-center gap-2">
        <input
          type="url"
          value={draft}
          onChange={(e) => setDraftOverride(e.target.value)}
          placeholder={`https://${APP_SHORT_ID}.example.com`}
          disabled={isLoading || saveMutation.isPending}
          className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dirty && draft.trim()) {
              saveMutation.mutate(draft.trim());
            }
          }}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => saveMutation.mutate(draft.trim() || null)}
          disabled={!dirty || saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : justSaved ? (
            <Check size={12} />
          ) : null}
          {justSaved ? 'Saved' : 'Save'}
        </Button>
        {saved && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => saveMutation.mutate(null)}
            disabled={saveMutation.isPending}
            aria-label="Clear remote base URL"
          >
            <Trash2 size={12} />
          </Button>
        )}
      </div>
      {saveMutation.isError && (
        <p className="text-[11px] text-destructive">
          {saveMutation.error instanceof Error ? saveMutation.error.message : 'Failed to save.'}
        </p>
      )}
    </div>
  );
}
