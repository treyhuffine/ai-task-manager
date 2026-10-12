'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Paperclip, Send, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { Attachment, TaskRecord } from '@/db/types';
import { api, apiErrorText } from '@/lib/api/client';
import { spaceApiBase } from '@/lib/spaces/document';
import { myRiClient } from '@/lib/spaces/my-ri-client';
import { useResults } from '@/hooks/use-results';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PublishedResultList } from './published-results';

/** A link's label from where it points: a pull request says so. */
function linkLabel(url: string): string {
  return /\/pull\/\d+|\/merge_requests\/\d+/.test(url) ? 'Pull request' : 'Link';
}

/**
 * What a shared task's team has had published to it, and Publish result
 * (docs/homes-spec.md §9.5, P7.5): the person picks a summary, a link such
 * as a pull request, or files, sees exactly who will see them, and shares
 * them. Nothing else goes: not the conversation, the agent, private
 * planning or where the work ran, and the task's status stays as it is.
 */
export function SharedPublishedResults({ task, teamName }: { task: TaskRecord; teamName: string }) {
  const [open, setOpen] = useState(false);
  const teamId = task.sourceTeamId!;
  const key = ['my-ri', 'published-results', task.id];
  const results = useQuery({
    queryKey: key,
    queryFn: () => myRiClient.spaces.publishedResults.query({ taskId: task.id }),
    enabled: task.sourceState === 'active',
  });
  if (task.sourceState !== 'active') return null;
  return (
    <section aria-label={`Published to ${teamName}`} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[12px] font-semibold">Published to {teamName}</h3>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-[11px] font-medium text-foreground hover:bg-muted"
        >
          <Send size={12} aria-hidden /> Publish result
        </button>
      </div>
      {results.error ? (
        <p className="text-xs text-muted-foreground">{apiErrorText(results.error)}</p>
      ) : (
        <PublishedResultList
          results={results.data ?? []}
          fileUrl={(fileName) => `${spaceApiBase(teamId)}/attachments/${fileName}`}
          empty={<p className="text-xs text-muted-foreground">Nothing yet. When the work is ready, publish what {teamName} should see.</p>}
        />
      )}
      {open && <PublishResultDialog task={task} teamName={teamName} onClose={() => setOpen(false)} />}
    </section>
  );
}

function PublishResultDialog({ task, teamName, onClose }: { task: TaskRecord; teamName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const teamId = task.sourceTeamId!;
  // One request per Publish: a retry after an unknown outcome is the same result.
  const [requestId] = useState(() => crypto.randomUUID());
  const audience = useQuery({ queryKey: ['my-ri', 'audience', teamId], queryFn: () => myRiClient.spaces.audience.query({ id: teamId }) });
  // The person's latest saved result for this task, offered as a start.
  const latest = useResults({ taskId: task.id, limit: 1 });
  const draft = latest.data?.[0];
  const draftLink = draft?.links?.find((l) => l.kind === 'url');

  const [summary, setSummary] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const summaryValue = summary ?? draft?.body ?? '';
  const urlValue = url ?? (draftLink?.kind === 'url' ? draftLink.url : '');
  const personalFiles = useMemo(() => draft?.attachments ?? [], [draft]);
  const nothing = !summaryValue.trim() && !urlValue.trim() && chosen.size === 0 && uploads.length === 0;

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        // Straight to the team: a new file chosen here is only ever the team's.
        const stored = await api.upload<Attachment>(`${spaceApiBase(teamId).replace(/^\/api/, '')}/attachments`, form);
        setUploads((prev) => [...prev, stored]);
      }
    } catch (err) {
      toast.error(apiErrorText(err));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const publish = async () => {
    setPublishing(true);
    try {
      const link = urlValue.trim() ? { label: linkLabel(urlValue.trim()), url: urlValue.trim() } : null;
      await myRiClient.spaces.publishResult.mutate({
        taskId: task.id,
        requestId,
        summary: summaryValue.trim() || null,
        link,
        personalAttachments: personalFiles.filter((f) => chosen.has(f.fileName)),
        teamAttachments: uploads,
      });
      toast.success(`Published to ${teamName}.`);
      void qc.invalidateQueries({ queryKey: ['my-ri', 'published-results', task.id] });
      onClose();
    } catch (err) {
      toast.error(apiErrorText(err));
    } finally {
      setPublishing(false);
    }
  };

  const members = audience.data?.members ?? [];
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Publish result to {teamName}</DialogTitle>
          <DialogDescription>Choose what {teamName} should see about this task.</DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs">
          <Users size={13} className="mt-0.5 flex-shrink-0 text-muted-foreground" aria-hidden />
          <p>
            <span className="font-medium">Everyone in {teamName} sees this</span>
            {members.length > 0 && <span className="text-muted-foreground">: {members.map((m) => m.name).join(', ')}</span>}
          </p>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium">Summary</span>
          <textarea
            value={summaryValue}
            onChange={(e) => setSummary(e.target.value)}
            rows={6}
            placeholder="What changed, and anything the team should know."
            className="w-full resize-y rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-primary/60"
          />
          {draft && summary === null && <span className="text-[11px] text-muted-foreground">From your latest saved result. Edit it before it&apos;s shared.</span>}
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium">Pull request or link</span>
          <input
            type="url"
            value={urlValue}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-primary/60"
          />
        </label>

        <div className="space-y-1.5">
          <span className="block text-xs font-medium">Files</span>
          {personalFiles.map((file) => (
            <label key={file.fileName} className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={chosen.has(file.fileName)}
                onCheckedChange={(checked) =>
                  setChosen((prev) => {
                    const next = new Set(prev);
                    if (checked) next.add(file.fileName);
                    else next.delete(file.fileName);
                    return next;
                  })
                }
              />
              <Paperclip size={12} className="text-muted-foreground" aria-hidden />
              <span className="truncate">{file.originalName}</span>
            </label>
          ))}
          {uploads.map((file) => (
            <p key={file.fileName} className="flex items-center gap-2 text-xs">
              <Paperclip size={12} className="text-muted-foreground" aria-hidden />
              <span className="truncate">{file.originalName}</span>
            </p>
          ))}
          <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            {uploading ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Paperclip size={12} aria-hidden />} Add a file
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Only what you choose here is shared. Your conversation, private notes and where the work ran stay with you, and the task&apos;s status stays as it is.
        </p>

        <DialogFooter>
          <button type="button" onClick={onClose} className="h-8 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            Cancel
          </button>
          <button
            type="button"
            disabled={nothing || publishing || uploading}
            onClick={() => void publish()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {publishing && <Loader2 size={12} className="animate-spin" aria-hidden />} Publish to {teamName}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
