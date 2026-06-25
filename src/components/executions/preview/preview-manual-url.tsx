'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, X, Link as LinkIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PreviewManualUrl } from '@/lib/api/preview';

interface PreviewManualUrlProps {
  /** Current manual URLs on the execution (default-service entry is used). */
  urls: PreviewManualUrl[];
  /** Persist the new list. Pass `[]` to clear. */
  onSave: (urls: PreviewManualUrl[]) => Promise<void> | void;
  isSaving?: boolean;
}

/**
 * BYO-tunnel input (§6). The user runs their own tunnel (ngrok, cloudflared,
 * …) and pastes the URL; Flow stores it and the ManualProvider serves it.
 * Single default-service URL for now — the data model carries more for
 * multi-service (§10).
 */
export function PreviewManualUrl({ urls, onSave, isSaving }: PreviewManualUrlProps) {
  const current = urls.find((u) => (u.service ?? null) === null)?.url ?? '';
  const [draft, setDraft] = useState(current);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!pending) setDraft(current);
  }, [current, pending]);

  useEffect(() => {
    if (!isSaving && pending) setPending(false);
  }, [isSaving, pending]);

  const save = async (next: string) => {
    const url = next.trim();
    setPending(true);
    const others = urls.filter((u) => (u.service ?? null) !== null);
    const list = url ? [...others, { service: null, url, label: null }] : others;
    try {
      await onSave(list);
    } catch {
      setPending(false);
    }
  };

  const dirty = draft.trim() !== current;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
        <LinkIcon size={12} className="text-muted-foreground" />
        Manual preview URL
      </label>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Running your own tunnel? Paste its URL and Flow will use it for the preview.
      </p>
      <div className="flex w-full items-stretch gap-1.5">
        <input
          type="url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); save(draft); }
          }}
          placeholder="https://abc.ngrok.app"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="button"
          onClick={() => save(draft)}
          disabled={!dirty || isSaving}
          title="Save URL"
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-foreground text-background transition-opacity hover:bg-foreground/90 disabled:opacity-40',
          )}
        >
          {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        </button>
        {current && (
          <button
            type="button"
            onClick={() => { setDraft(''); save(''); }}
            disabled={isSaving}
            title="Clear URL"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
