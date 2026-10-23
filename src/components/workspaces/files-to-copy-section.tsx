'use client';

import { ChevronDown, FileText, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc/client';
import { workspacesApi, type PreviewFilesToCopyResponse } from '@/lib/api/workspaces';
import { cn } from '@/lib/utils';
import { Tip } from '@/components/ui/tip';
import { useExecutionRuntimeScope } from '@/components/home/execution-runtime-context';

interface FilesToCopySectionProps {
  /** Globs as a string array. Empty array = nothing copied. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Resolved source folder. Empty = preview is hidden. */
  cwd: string;
  /** Optional class for outer wrapper. */
  className?: string;
  /** Whether the preview list defaults to expanded. Defaults to `true`. */
  defaultExpanded?: boolean;
}

const PREVIEW_DEBOUNCE_MS = 350;

function globsToText(globs: string[]): string {
  return globs.join('\n');
}

function textToGlobs(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function FilesToCopySection({
  value,
  onChange,
  cwd,
  className,
  defaultExpanded = true,
}: FilesToCopySectionProps) {
  const { canConfigureAgents } = useExecutionRuntimeScope();
  // Local text state so we can preserve in-progress newlines/whitespace
  // without round-tripping through `string[]` and snapping the cursor.
  const [text, setText] = useState(() => globsToText(value));
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Sync external value changes (e.g. settings sheet loaded a workspace)
  // back into the textarea — but only when the parsed arrays actually
  // differ, so the user's typing isn't disrupted. Set while rendering, so the
  // textarea never paints the old list. Compared as text, so a caller that
  // passes an equal new array each render changes nothing.
  const incoming = globsToText(value);
  const [valueText, setValueText] = useState(incoming);
  const [lastSynced, setLastSynced] = useState(incoming);
  if (incoming !== valueText) {
    setValueText(incoming);
    if (incoming !== lastSynced) {
      setLastSynced(incoming);
      setText(incoming);
    }
  }

  const globs = useMemo(() => textToGlobs(text), [text]);
  const trimmedCwd = cwd.trim();
  const shouldPreview = canConfigureAgents && trimmedCwd.length > 0 && globs.length > 0;

  const query = useQuery<PreviewFilesToCopyResponse>({
    queryKey: trpc.workspaces.previewFiles.queryKey({ body: { cwd: trimmedCwd, globs } }),
    placeholderData: previous => previous?.root === trimmedCwd ? previous : undefined,
    enabled: shouldPreview,
    retry: false,
    queryFn: async ({ signal }) => {
      await new Promise<void>((resolve, reject) => {
        const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(finish, PREVIEW_DEBOUNCE_MS);
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      return workspacesApi.previewFilesToCopy(trimmedCwd, globs);
    },
  });
  const preview = shouldPreview ? query.data : undefined;
  const previewError = query.error?.message;
  const loading = query.isFetching;

  const handleTextChange = (next: string) => {
    setText(next);
    const nextGlobs = textToGlobs(next);
    setLastSynced(globsToText(nextGlobs));
    onChange(nextGlobs);
  };

  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Files to copy
      </label>
      <p className="text-[10.5px] text-muted-foreground/70 leading-snug">
        Each new session&apos;s worktree gets a fresh copy of these files
        from the source folder. One glob per line. Bare patterns like{' '}
        <code className="font-mono">.env*</code> match at any depth. Files
        git tracks are skipped, since the worktree already has them.
      </p>
      <textarea
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        placeholder=".env*"
        rows={3}
        spellCheck={false}
        className="w-full px-3 py-2 text-xs font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary resize-y min-h-16"
      />

      {!canConfigureAgents ? <p className="text-[10px] text-muted-foreground/70">The owner configures files copied into new worktrees.</p> : trimmedCwd.length === 0 ? (
        <p className="text-[10px] text-muted-foreground/60">
          Pick a folder above to preview the files this matches.
        </p>
      ) : globs.length === 0 ? (
        <p className="text-[10px] text-muted-foreground/60">
          No globs configured. Nothing will be copied.
        </p>
      ) : (
        <div className="rounded-md border border-border bg-muted/20 overflow-hidden">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/40 transition-colors"
          >
            <span className="flex items-center gap-1.5 min-w-0">
              {loading ? (
                <Loader2 size={11} className="animate-spin shrink-0" />
              ) : (
                <FileText size={11} className="shrink-0" />
              )}
              <span className="truncate">
                {previewError
                  ? 'Preview failed'
                  : preview
                    ? `${preview.files.length}${preview.truncated ? '+' : ''} ${
                        preview.files.length === 1 ? 'file' : 'files'
                      } will be copied from `
                    : 'Scanning…'}
                {!previewError && preview && (
                  <code className="font-mono text-foreground/70">{preview.root}</code>
                )}
              </span>
            </span>
            <ChevronDown
              size={11}
              className={cn('shrink-0 transition-transform', expanded && 'rotate-180')}
            />
          </button>
          {expanded && (
            <div className="border-t border-border max-h-48 overflow-y-auto bg-background/40">
              {previewError ? (
                <p className="px-2.5 py-2 text-[10.5px] text-destructive">
                  {previewError}
                </p>
              ) : !preview ? null : preview.files.length === 0 ? (
                <p className="px-2.5 py-2 text-[10.5px] text-muted-foreground/60 italic">
                  No matches in this folder.
                </p>
              ) : (
                <ul className="font-mono text-[10.5px] text-foreground/80">
                  {preview.files.map((f) => (
                    <Tip key={f} label={f} onlyWhenTextHidden>
                      <li className="px-2.5 py-0.5 hover:bg-muted/40 truncate">
                        {f}
                      </li>
                    </Tip>
                  ))}
                  {preview.truncated && (
                    <li className="px-2.5 py-1 text-muted-foreground/60 italic">
                      … truncated. Tighten the globs if this list is bigger than expected.
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
