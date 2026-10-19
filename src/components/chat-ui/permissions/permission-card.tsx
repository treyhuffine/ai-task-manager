'use client';

import { useState } from 'react';
import { ShieldCheck, Wrench, Loader2 } from 'lucide-react';
import { useResolvePendingInput } from '@/hooks/use-execution';
import { toolDisplayName } from '@/lib/executions/tool-display';
import type { PendingPermission } from '@/lib/api/sessions';

export function PermissionCard({
  pending,
  sessionId,
}: {
  pending: PendingPermission;
  sessionId: string;
}) {
  const resolve = useResolvePendingInput(sessionId);
  const [denyReason, setDenyReason] = useState('');
  const [showDenyInput, setShowDenyInput] = useState(false);

  const allow = () =>
    resolve.mutate({ requestId: pending.requestId, body: { allow: true } });

  const deny = () =>
    resolve.mutate({
      requestId: pending.requestId,
      body: { allow: false, message: denyReason.trim() || undefined },
    });

  return (
    <div className="rounded-xl border border-blue-500/30 bg-card overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-200">
      <div className="flex items-center gap-2.5 px-3.5 py-2 bg-blue-500/5 border-b border-blue-500/20">
        <ShieldCheck size={12} className="text-blue-500 shrink-0" />
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className="text-[11.5px] font-semibold text-foreground">
            Permission requested
          </span>
          <span className="text-[10.5px] text-muted-foreground/70 font-mono truncate">
            {toolDisplayName(pending.toolName)}
          </span>
        </div>
      </div>

      <div className="px-4 py-3">
        {pending.title && (
          <div className="text-[12.5px] font-medium text-foreground mb-1.5 leading-snug">
            {pending.title}
          </div>
        )}
        {pending.description && (
          <div className="text-[11.5px] text-muted-foreground mb-2 leading-snug">
            {pending.description}
          </div>
        )}
        <ToolInputPreview input={pending.input} />
      </div>

      {showDenyInput && (
        <div className="px-4 pb-2">
          <textarea
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            placeholder="Optional: tell the agent why (e.g. 'use Read instead')"
            rows={2}
            className="w-full text-[11.5px] bg-background border border-border rounded-md px-2 py-1.5 resize-none focus:outline-none focus:border-primary/50"
            autoFocus
          />
        </div>
      )}

      <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border bg-muted/20">
        <button
          type="button"
          disabled={resolve.isPending}
          onClick={() => (showDenyInput ? deny() : setShowDenyInput(true))}
          className="flex-1 px-3 py-1.5 rounded-md text-[11.5px] font-medium text-destructive border border-destructive/40 hover:bg-destructive/10 transition-colors disabled:opacity-50"
        >
          {resolve.isPending && !showDenyInput
            ? 'Denying…'
            : showDenyInput
              ? denyReason.trim() ? 'Send deny' : 'Deny'
              : 'Deny'}
        </button>
        <button
          type="button"
          disabled={resolve.isPending}
          onClick={allow}
          className="flex-1 px-3 py-1.5 rounded-md text-[11.5px] font-medium bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
        >
          {resolve.isPending && !showDenyInput ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 size={10} className="animate-spin" /> Allowing
            </span>
          ) : (
            'Allow'
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Tool input preview ───────────────────────────────────────

function ToolInputPreview({ input }: { input: Record<string, unknown> }) {
  // Common tool fields. Pick the one most useful for at-a-glance review.
  const path = pickString(input, ['file_path', 'path', 'notebook_path']);
  const command = pickString(input, ['command']);
  const url = pickString(input, ['url']);
  const pattern = pickString(input, ['pattern']);
  const query = pickString(input, ['query']);

  const primary = path ?? command ?? url ?? pattern ?? query;

  if (!primary) {
    return (
      <pre className="text-[10.5px] font-mono text-muted-foreground bg-muted/30 rounded p-2 max-h-24 overflow-auto whitespace-pre-wrap break-words">
        {JSON.stringify(input, null, 2).slice(0, 300)}
      </pre>
    );
  }

  return (
    <div className="flex items-start gap-2 text-[11.5px] font-mono bg-muted/30 rounded px-2 py-1.5 max-h-24 overflow-hidden">
      <Wrench size={11} className="text-muted-foreground shrink-0 mt-0.5" />
      <span className="text-foreground break-all line-clamp-3">{primary}</span>
    </div>
  );
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}
