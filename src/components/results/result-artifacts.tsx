'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink, Globe, Loader2, MessageSquare } from 'lucide-react';
import { MessageFileChip } from '@/components/chat/message-file-chip';
import { Button } from '@/components/ui/button';
import { workResultsApi, type WorkResultFeedbackContext } from '@/lib/api/results';
import { apiErrorText } from '@/lib/api/client';
import { pickReachability, resolvePreviewSrc } from '@/lib/preview/resolve-iframe-src';
import type { WorkResultRecord } from '@/db/types';
import { resultLinkUrl } from './presentation';

export function ResultArtifacts({ result, onFeedback }: { result: WorkResultRecord; onFeedback?: (context: WorkResultFeedbackContext) => void }) {
  const attachments = result.attachments ?? [];
  if (!attachments.length && !result.links.length) return null;
  return (
    <div className="space-y-3">
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-start gap-2" aria-label="Saved files">
          {attachments.map((attachment) => (
            <div key={attachment.fileName} className="min-w-0 max-w-full">
              <MessageFileChip attachment={attachment} />
              {onFeedback && (
                <button className="block px-1 text-[10.5px] text-muted-foreground hover:text-foreground" onClick={() => onFeedback({ attachmentFileName: attachment.fileName })}>
                  Discuss this file
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {result.links.map((link, index) => link.kind === 'preview' ? (
          <ResultPreview key={`${link.previewTargetId}-${index}`} resultId={result.id} targetId={link.previewTargetId} label={link.label} onFeedback={onFeedback} />
        ) : (
          resultLinkUrl(link.url) ? (
            <a key={`${link.url}-${index}`} href={resultLinkUrl(link.url)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted">
              <ExternalLink size={12} />{link.label}
            </a>
          ) : <span key={index} className="text-xs text-muted-foreground">{link.label}: unavailable link</span>
        ))}
      </div>
    </div>
  );
}

function ResultPreview({ resultId, targetId, label, onFeedback }: { resultId: string; targetId: string; label: string; onFeedback?: (context: WorkResultFeedbackContext) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [resolved, setResolved] = useState<Awaited<ReturnType<typeof workResultsApi.preview>> | null>(null);
  const state = useQuery({
    queryKey: ['results', resultId, 'preview', targetId],
    queryFn: () => workResultsApi.preview(resultId, targetId),
    enabled: expanded,
    refetchInterval: expanded ? 4_000 : false,
    retry: false,
  });
  const open = useMutation({
    mutationFn: () => workResultsApi.openPreview(resultId, targetId, pickReachability() === 'remote'),
    onSuccess: setResolved,
  });
  const current = resolved ? { ...state.data, ...resolved, serverStatus: state.data?.serverStatus ?? resolved.serverStatus } : state.data ?? null;
  const preview = resolvePreviewSrc(current);
  return (
    <div id={`preview-${targetId}`} className="w-full rounded-lg border text-xs">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button className="flex items-center gap-1.5 font-medium" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          <Globe size={13} />{label}
        </button>
        {expanded && <span className="text-muted-foreground">{current?.serverStatus ?? (state.isLoading ? 'Loading' : 'Unavailable')}</span>}
        {onFeedback && <button className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => onFeedback({ previewTargetId: targetId })}><MessageSquare size={11} />Discuss preview</button>}
      </div>
      {expanded && (
        <div className="space-y-2 border-t p-3">
          <p className="text-[11px] text-muted-foreground">Live previews may have changed since this handoff was saved.</p>
          {(state.error || open.error) && <p role="alert" className="text-destructive">{apiErrorText(open.error ?? state.error)}</p>}
          {current?.message && <p className="text-muted-foreground">{current.message}</p>}
          {current?.remoteError && <p className="text-muted-foreground">{current.remoteError.message}</p>}
          {preview.url ? (
            <>
              <a href={preview.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary"><ExternalLink size={12} />Open preview</a>
              <iframe src={preview.url} title={label} className="h-80 w-full rounded border bg-white" />
            </>
          ) : !state.error && (
            <Button size="xs" variant="outline" onClick={() => open.mutate()} disabled={open.isPending || current?.serverStatus === 'starting' || current?.setupStatus === 'running'}>
              {open.isPending && <Loader2 className="animate-spin" />}
              {current?.serverStatus === 'running' ? 'Open on this device' : current?.serverStatus === 'starting' ? 'Starting preview' : 'Start preview'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
