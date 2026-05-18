'use client';

import { useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PreviewPortlessEmptyProps {
  hostname: string;
  /** The supervisor wrote a message explaining why the route is missing. */
  message?: string | null;
}

/**
 * Empty state shown in Portless mode when no route is registered for the
 * workspace's hostname. Surfaces a one-click `portless run` command the
 * user copies and pastes into their terminal inside the worktree.
 */
export function PreviewPortlessEmpty({ hostname, message }: PreviewPortlessEmptyProps) {
  const command = `portless ${hostname} <your dev command>`;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex h-full w-full items-center justify-center bg-background px-6 py-10">
      <div className="flex w-full max-w-md flex-col items-start gap-4">
        <h3 className="text-[15px] font-semibold text-foreground">No Portless app registered</h3>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {message ?? `Flow is in Portless mode for this workspace. Run your dev server through Portless and the preview will appear here.`}
        </p>
        <div className="w-full">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            Run in your terminal
          </div>
          <div className="flex items-stretch overflow-hidden rounded-md border border-border bg-muted/40">
            <pre className="flex-1 overflow-x-auto px-3 py-2 font-mono text-[12px] text-foreground">
              {command}
            </pre>
            <button
              type="button"
              onClick={handleCopy}
              className={cn(
                'flex w-9 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                copied && 'text-foreground',
              )}
              title="Copy"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground/70">
            Replace <code className="font-mono">&lt;your dev command&gt;</code> with whatever starts your app
            {' '}— e.g. <code className="font-mono">next dev</code>, <code className="font-mono">vite</code>,
            {' '}<code className="font-mono">flask run</code>.
          </p>
        </div>
        <a
          href="https://portless.sh"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-muted-foreground"
        >
          Portless docs <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}
