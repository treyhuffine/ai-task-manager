'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CopyMessageButtonProps {
  text: string;
  /** Where to align the button in its row. Defaults to right. */
  align?: 'left' | 'right';
  /**
   * When true, the button stays visible all the time (used for AI
   * messages — always-on so the user has an obvious affordance to grab
   * the response). When false, fades in on row hover (user messages).
   */
  alwaysVisible?: boolean;
  /**
   * Optional timestamp to show next to the copy icon on hover. Accepts
   * a Date, a number (ms), or an ISO string. Always hover-only — even
   * when the icon itself is alwaysVisible — to keep the row quiet.
   */
  timestamp?: Date | number | string | null;
  className?: string;
}

/**
 * Hover-revealed action row under a chat message. Carries a copy icon
 * and (optionally) the message timestamp. Shared between execution
 * chat and the orchestrator chat so both surfaces read the same.
 *
 * The "copied" tick stays for ~1.2s before reverting. Clipboard write
 * failures are silent — the icon just doesn't flip — so users on
 * insecure contexts can retry without seeing a scary error.
 */
export function CopyMessageButton({
  text,
  align = 'right',
  alwaysVisible = false,
  timestamp,
  className,
}: CopyMessageButtonProps) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable (insecure context, denied permission).
      // Silently fail — user retries or copies manually.
    }
  };

  const formattedTime = timestamp ? formatTimestamp(timestamp) : null;

  // The icon hugs the message-bubble edge so it sits where the user's
  // attention already is. Timestamp goes on the *outside* — to the
  // right of the icon for left-aligned (AI) rows, to the left of the
  // icon for right-aligned (user) rows. That way it never crosses the
  // bubble axis, keeping the "what" (icon) close and the "when"
  // (metadata) tucked away.
  const timeNode = formattedTime ? (
    <span
      className={cn(
        'text-[10px] text-muted-foreground/70 tabular-nums',
        'opacity-0 group-hover:opacity-100 transition-opacity',
      )}
      aria-hidden
    >
      {formattedTime}
    </span>
  ) : null;

  const iconNode = (
    <button
      type="button"
      onClick={onClick}
      aria-label={copied ? 'Copied' : 'Copy message'}
      title={copied ? 'Copied' : 'Copy message'}
      className={cn(
        'inline-flex items-center justify-center w-5 h-5 rounded',
        'text-muted-foreground hover:text-foreground hover:bg-muted/60',
        'transition-all',
        alwaysVisible ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100',
      )}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 mt-0.5',
        align === 'right' ? 'justify-end' : 'justify-start',
        className,
      )}
    >
      {align === 'right' ? (
        <>
          {timeNode}
          {iconNode}
        </>
      ) : (
        <>
          {iconNode}
          {timeNode}
        </>
      )}
    </div>
  );
}

/** "Apr 23, 9:40 AM" — short and consistent across both chat surfaces. */
function formatTimestamp(input: Date | number | string): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  const datePart = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timePart = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}
