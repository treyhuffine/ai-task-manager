'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { apiErrorText } from '@/lib/api/client';

/** An unanswered read, including a paused offline query, never means no chat. */
export function ChatLookupState({ paused, error, retry, subject = 'chat' }: { paused?: boolean; error?: unknown; retry: () => void; subject?: 'chat' | 'agent' }) {
  return <section role="status" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm">
    {!paused && !error && <Loader2 size={16} className="animate-spin text-muted-foreground" />}
    <p>{error ? `This ${subject} is unavailable` : paused ? `You are offline. This ${subject} will load when you reconnect.` : `Opening ${subject}`}</p>
    {Boolean(error) && <p className="max-w-sm text-muted-foreground">{apiErrorText(error)}</p>}
    {(paused || Boolean(error)) && <button onClick={retry} className="underline">Retry</button>}
  </section>;
}

/** Keep the already loaded editor/transcript mounted during a failed refresh. */
export function ChatRefreshNotice({ error, retry }: { error: unknown; retry: () => void }) {
  return error ? <div role="status" className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground">
    <span>Could not refresh this chat. {apiErrorText(error)}</span><button onClick={retry} className="shrink-0 underline">Retry</button>
  </div> : null;
}

const refreshNotice = createContext(false);
/** Nested readers describe one outage once while retaining their mounted content. */
export function ChatRefreshBoundary({ error, retry, children }: { error: unknown; retry: () => void; children: ReactNode }) {
  const inherited = useContext(refreshNotice);
  return <refreshNotice.Provider value={inherited || Boolean(error)}><ChatRefreshNotice error={inherited ? null : error} retry={retry} />{children}</refreshNotice.Provider>;
}
