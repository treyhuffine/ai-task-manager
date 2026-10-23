'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAreas } from '@/hooks/use-areas';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { apiErrorText } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { invalidateTeamContent } from '@/lib/spaces/client-cache';

/** Private rules live in the personal document and use its authenticated client. */
export function TeamAreaDefaults({ teamId, connected }: { teamId: string; connected: boolean }) {
  const qc = useQueryClient();
  const rules = useQuery(trpc.spaces.areaDefaults.list.queryOptions({ id: teamId }));
  const sources = useQuery({ ...trpc.spaces.areaDefaults.sourceAreas.queryOptions({ id: teamId }), enabled: connected });
  const areas = useAreas();
  const [review, setReview] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const scope = { teamId, sourceAreaId: null };
  const preview = useQuery({ ...trpc.spaces.areaDefaults.preview.queryOptions(scope), enabled: review && connected });
  const save = useMutation({
    mutationFn: (input: { sourceAreaId: string | null; areaId: string | null }) => trpcClient.spaces.areaDefaults.set.mutate({ teamId, ...input }),
    onSuccess: () => {
      setReview(false);
      void qc.invalidateQueries({ queryKey: trpc.spaces.areaDefaults.list.queryKey({ id: teamId }) });
    },
    onError: (err) => toast.error(apiErrorText(err)),
  });
  const apply = useMutation({
    mutationFn: () => trpcClient.spaces.areaDefaults.applyExisting.mutate({ ...scope, selected: (preview.data ?? []).filter((r) => selected.includes(`${r.entityType}:${r.id}`)).map(({ entityType, id, areaId }) => ({ entityType, id, areaId })) }),
    onSuccess: ({ changed }) => {
      toast.success(`Updated ${changed} reference${changed === 1 ? '' : 's'}.`);
      setReview(false);
      invalidateTeamContent(qc);
    },
    onError: (err) => toast.error(apiErrorText(err)),
  });
  const active = (areas.data ?? []).filter((a) => a.status !== 'archived');
  const sourceIds = new Set(sources.data?.map((a) => a.id));
  const scopes = [
    { id: null, name: 'Whole team', inactive: false },
    ...(sources.data ?? []).map((a) => ({ id: a.id, name: a.name, inactive: false })),
    ...(rules.data ?? []).filter((r) => r.sourceAreaId && !sourceIds.has(r.sourceAreaId)).map((r) => ({ id: r.sourceAreaId, name: 'Unavailable team Area', inactive: true })),
  ];
  return (
    <div className="w-full space-y-3 text-xs">
      <p className="text-muted-foreground">Only you. Choose an optional personal Area for future imports and saved notes. A team Area rule takes precedence. Existing choices stay as they are.</p>
      {scopes.map((s) => {
        const rule = rules.data?.find((r) => r.sourceAreaId === s.id);
        const unavailable = !!rule && !active.some((a) => a.id === rule.areaId);
        return (
          <label key={s.id ?? 'team'} className="flex flex-wrap items-center justify-between gap-2">
            <span>{s.name}{s.inactive ? ' (inactive)' : ''}</span>
            <select aria-label={`Personal Area default for ${s.name}`} className="max-w-full rounded border bg-background p-1.5" value={rule?.areaId ?? ''} disabled={save.isPending || apply.isPending} onChange={(e) => save.mutate({ sourceAreaId: s.id, areaId: e.target.value || null })}>
              <option value="">No default</option>
              {unavailable && <option value={rule.areaId}>Unavailable personal Area (inactive)</option>}
              {active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        );
      })}
      {sources.error && <p role="alert">Team Areas could not be loaded. <button className="underline" onClick={() => void sources.refetch()}>Retry</button></p>}
      {!review && connected && <Button size="sm" variant="outline" onClick={() => { setSelected([]); setReview(true); void preview.refetch(); }}>Review existing unorganized work</Button>}
      {review && (
        <div className="space-y-2 rounded border p-3">
          <p>{preview.isFetching ? 'Checking references…' : `${preview.data?.length ?? 0} unorganized references in this team.`} Select the work to organize. Deliberately cleared Areas are excluded.</p>
          {preview.error && <p role="alert">Could not load the preview. <button className="underline" onClick={() => void preview.refetch()}>Retry</button></p>}
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {(preview.data ?? []).map((r) => {
              const key = `${r.entityType}:${r.id}`;
              return <label key={key} className="flex items-start gap-2"><input type="checkbox" checked={selected.includes(key)} disabled={apply.isPending} onChange={(e) => setSelected((old) => e.target.checked ? [...old, key] : old.filter((k) => k !== key))} /><span>{r.title || 'Untitled note'} → {active.find((a) => a.id === r.areaId)?.name ?? 'Area'}{r.requiresReview && <span className="block text-muted-foreground">Earlier choice unknown. Review before selecting.</span>}</span></label>;
            })}
          </div>
          <div className="flex gap-2"><Button size="sm" disabled={!selected.length || apply.isPending || preview.isFetching} onClick={() => apply.mutate()}>Apply to {selected.length} selected</Button><Button size="sm" variant="ghost" disabled={apply.isPending} onClick={() => setReview(false)}>Cancel</Button></div>
        </div>
      )}
    </div>
  );
}
