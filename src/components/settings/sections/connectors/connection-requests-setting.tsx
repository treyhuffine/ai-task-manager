'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { apiErrorText } from '@/lib/api/client';
import { connectionRequestsApi } from '@/lib/api/connection-requests';
import { GroupHeading } from './parts';

const KEY = ['connectors', 'request-settings'] as const;

/**
 * The escape hatch for agents asking to connect accounts from chat: on by default, one switch to
 * turn it off. Off takes effect for chats started (or restarted) afterwards. Reconnect cards for a
 * connection that stopped working still show, since they come from a failed call.
 */
export function ConnectionRequestsSetting() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: KEY, queryFn: connectionRequestsApi.settings });
  const save = useMutation({
    mutationFn: connectionRequestsApi.setRequestsEnabled,
    onMutate: (requestsEnabled) => qc.setQueryData(KEY, { requestsEnabled }),
    onError: (err) => {
      toast.error(apiErrorText(err));
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
  return (
    <section className="space-y-2">
      <GroupHeading>In chat</GroupHeading>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/20 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">Agents can ask to connect accounts</p>
          <p className="text-[11px] leading-normal text-muted-foreground">
            When a request needs a service that isn’t connected, the agent shows a Connect card in the chat. Applies to chats started after you change it.
          </p>
        </div>
        <Switch
          size="sm"
          checked={data?.requestsEnabled ?? true}
          disabled={!data || save.isPending}
          onCheckedChange={(on) => save.mutate(on)}
          aria-label="Agents can ask to connect accounts"
        />
      </div>
    </section>
  );
}
