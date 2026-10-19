'use client';

import { AppWindow } from 'lucide-react';
import { Tip } from '@/components/ui/tip';

/**
 * A message a connected app sent for the person (OpenAI's `ui/message`
 * with `send`, docs/connected-mcp-apps.md "Messages"). Sits where
 * `SenderChip` names a chat that sent one, so the transcript never passes an
 * app's words off as the person's typing.
 */
export function AppSenderChip({ app }: { app: string }) {
  const label = `From ${app}`;
  return (
    <Tip label="Sent by the app while you used it">
      <span className="self-end mb-0.5 inline-flex max-w-[18rem] items-center gap-1 rounded-full px-1.5 py-px text-[10.5px] text-muted-foreground">
        <AppWindow size={10} className="flex-shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </span>
    </Tip>
  );
}

/** The app named on a stored message, from `raw.sentByApp` as the transcript receives it. */
export function sentByApp(raw: unknown): string | null {
  const app = (raw as { sentByApp?: { app?: unknown } } | null | undefined)?.sentByApp?.app;
  return typeof app === 'string' && app.trim() ? app.trim().slice(0, 120) : null;
}
