'use client';

import { useMemo } from 'react';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import { X, Loader2 } from 'lucide-react';
import { useSessionDiff } from '@/hooks/use-execution';
import { cn } from '@/lib/utils';
import type { StructuredDiffFile, StructuredDiffHunk } from '@/lib/api/sessions';

interface DiffSlideoutProps {
  sessionId: string;
  filePath: string | null;
  onClose: () => void;
}

/**
 * File-level structured-diff viewer. Renders the response from
 * `@agentex/workspace`'s `ws.git.diff('base')` filtered to a single
 * file. Slideout style — matches the app's existing slide-from-right
 * pattern used by note/task/area slideouts.
 */
export function DiffSlideout({ sessionId, filePath, onClose }: DiffSlideoutProps) {
  const { data, isLoading } = useSessionDiff(filePath ? sessionId : null, filePath ?? undefined);
  const file = useMemo(() => data?.files[0], [data]);

  return (
    <DialogPrimitive.Root open={!!filePath} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed right-0 top-0 z-50 h-full w-full max-w-3xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Diff: {filePath ?? ''}</DialogPrimitive.Title>
            <DialogPrimitive.Description>Structured diff for the selected file</DialogPrimitive.Description>
          </VisuallyHidden.Root>
          <div className="h-full bg-background border-l border-border flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-foreground truncate">
                  {filePath ?? ''}
                </p>
                {file && (
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5 capitalize">
                    {file.status}
                    {file.oldPath && file.oldPath !== file.path && ` from ${file.oldPath}`}
                  </p>
                )}
              </div>
              <DialogPrimitive.Close asChild>
                <button className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0">
                  <X size={16} />
                </button>
              </DialogPrimitive.Close>
            </div>

            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 size={20} className="animate-spin text-muted-foreground" />
                </div>
              ) : !file ? (
                <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground/70">
                  No diff for this file.
                </div>
              ) : (
                <DiffFileView file={file} />
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function DiffFileView({ file }: { file: StructuredDiffFile }) {
  if (file.hunks.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground/70">
        Empty diff (file may be binary or only metadata changed).
      </div>
    );
  }
  return (
    <div className="font-mono text-[11px] leading-[1.55]">
      {file.hunks.map((hunk, i) => (
        <DiffHunkView key={`${hunk.oldStart}-${hunk.newStart}-${i}`} hunk={hunk} />
      ))}
    </div>
  );
}

function DiffHunkView({ hunk }: { hunk: StructuredDiffHunk }) {
  return (
    <div className="border-b border-border/40 last:border-b-0">
      <div className="px-4 py-1 text-[10px] text-muted-foreground/70 bg-muted/40">
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      </div>
      {hunk.lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            'px-4 whitespace-pre',
            line.kind === 'add' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
            line.kind === 'del' && 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
            line.kind === 'ctx' && 'text-foreground/80',
          )}
        >
          {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
          {line.text}
        </div>
      ))}
    </div>
  );
}
