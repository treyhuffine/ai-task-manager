'use client';

import { useEffect, useRef, useState } from 'react';
import { AudioLines, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUserState, useUpdateUserState } from '@/hooks/use-user-state';

/**
 * "Sent with voice" badge — anchors to the bottom-right of a user
 * message and reveals an auto-send toggle popover. Same shape used by
 * the orchestrator chat (content-panel.tsx VoiceSentBadge), pulled
 * into a shared module so both surfaces render identically.
 *
 * Toggle writes through `useUpdateUserState({ voiceAutoSend })`.
 * That setting is global, but it's the same setting all our voice
 * surfaces share — touching it here flips the orchestrator chat too.
 */
export function VoiceSentBadge() {
  const { data: userState } = useUserState();
  const updateUserState = useUpdateUserState();
  const voiceAutoSend = userState?.voiceAutoSend ?? true;
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const toggle = () => updateUserState.mutate({ voiceAutoSend: !voiceAutoSend });

  return (
    <div className="flex justify-end relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/40 rounded-full px-2 py-0.5 transition-all"
      >
        <AudioLines size={10} />
        <span>Sent with voice</span>
        <ChevronDown size={8} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-56 rounded-lg border border-border bg-card shadow-xl z-50 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-foreground">Auto-send voice</span>
            <button
              type="button"
              role="switch"
              aria-checked={voiceAutoSend}
              onClick={toggle}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors',
                voiceAutoSend ? 'bg-primary' : 'bg-muted',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform',
                  voiceAutoSend ? 'translate-x-4' : 'translate-x-0',
                )}
              />
            </button>
          </div>
          <p className="text-[9px] text-muted-foreground leading-relaxed">
            {voiceAutoSend
              ? 'Voice input sends immediately.'
              : 'Voice input goes to the text box for editing.'}
            {' '}Also in profile settings.
          </p>
        </div>
      )}
    </div>
  );
}
