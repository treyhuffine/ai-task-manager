'use client';

import { useId } from 'react';
import { Switch } from '@/components/ui/switch';
import { useUserState, useUpdateUserState } from '@/hooks/use-user-state';

/**
 * Status lines (docs/chat-status-lines.md), a trial, on by default. Off, the
 * rule leaves the chats' instructions and every status is cleared, so the
 * app is as it was.
 */
export function ChatStatusLinesSetting() {
  const id = useId();
  const preference = useUserState();
  const update = useUpdateUserState();
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-2">
      <div>
        <label htmlFor={id} className="text-sm text-foreground">Status lines (trial)</label>
        <p id={`${id}-description`} className="mt-0.5 text-[11px] text-muted-foreground/85">
          Each chat ends its turn with one line on where it stands, shown under its title in Recent and Unread. When it needs you, the line says what to do and its agent estimates how long that takes you.
        </p>
      </div>
      <Switch
        id={id}
        size="sm"
        checked={preference.data?.chatStatusLines ?? true}
        disabled={!preference.isSuccess}
        aria-describedby={`${id}-description`}
        onCheckedChange={(chatStatusLines) => update.mutate({ chatStatusLines })}
      />
    </div>
  );
}
