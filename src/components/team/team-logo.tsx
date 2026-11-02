'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { uploadAttachment } from '@/lib/attachments/client';
import { attachmentUrl } from '@/lib/attachments/view';
import { apiErrorText } from '@/lib/api/client';
import { useUserState } from '@/hooks/use-user-state';
import { OrchestratorMark } from '@/components/shared/orchestrator-mark';
import { useHomeContext } from '@/components/home/home-context';
import { useTeam } from './team-context';
import type { Attachment, UserStateRecord } from '@/db/types';

export function TeamLogo() {
  const { team } = useTeam();
  const canManage = useHomeContext().capabilities.administerMembers;
  const { data } = useUserState();
  const cache = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const save = useMutation({
    mutationFn: (image: Attachment | null) => trpcClient.team.setLogo.mutate({ image }),
    meta: { carriesInput: true },
    onSuccess: ({ image }) => {
      cache.setQueryData<UserStateRecord>(trpc.userState.list.queryKey({}), previous => previous ? { ...previous, orchestratorImage: image } : previous);
      void cache.invalidateQueries({ queryKey: trpc.userState.list.queryKey({}) });
    },
  });
  const busy = uploading || save.isPending;
  const image = data?.orchestratorImage;
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const attachment = await uploadAttachment(file);
      await save.mutateAsync(attachment);
      toast.success('Team logo saved');
    } catch (error) {
      toast.error('Could not save the team logo', { description: apiErrorText(error) });
    } finally { setUploading(false); }
  };
  return <div className="flex items-center gap-3">
    <OrchestratorMark name={team.name} imageUrl={image ? attachmentUrl(image.fileName) : null} size="lg" className="object-contain" />
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-medium">Team logo</p>
      <p className="text-xs text-muted-foreground">Your company or team logo, shown beside the team name and shared assistant.</p>
      {canManage && <div className="flex items-center gap-2">
        <input ref={input} type="file" accept="image/*" aria-label="Team logo file" className="hidden" disabled={busy} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (file) void upload(file);
        }} />
        <button type="button" onClick={() => input.current?.click()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted/50 disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}{image ? 'Change logo' : 'Upload logo'}
        </button>
        {image && <button type="button" disabled={busy} className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 disabled:opacity-50" onClick={() => {
          void save.mutateAsync(null).catch(error => toast.error('Could not remove the team logo', { description: apiErrorText(error) }));
        }}>Remove logo</button>}
      </div>}
    </div>
  </div>;
}
