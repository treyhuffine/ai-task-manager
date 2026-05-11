'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, RefreshCw, X, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { sessionsApi } from '@/lib/api/sessions';
import { useClaudeAuthStatus } from '@/hooks/use-claude-login';
import { useDashboard } from '@/contexts/dashboard-context';
import { cn } from '@/lib/utils';
import type { StuckSession } from '@/app/api/claude-auth/stuck-sessions/route';

const STUCK_KEY = ['claude-auth-stuck-sessions'] as const;

/**
 * Floating bottom-right card listing active sessions whose latest event
 * is `auth_required`. Shown after the user is logged in (the in-chat
 * banner handles the unauthenticated case), so the actions on this card
 * are all "Resend" — the natural recovery now that auth is restored.
 *
 * Mounted globally in the root layout. Hides itself when there are no
 * stuck sessions or the user has dismissed it. Dismissal is undone the
 * moment a new session appears in the list — opening another stuck chat
 * brings the card back without nagging.
 *
 * Refetches on focus and after login completes (`claude-auth-status` is
 * invalidated by the login mutation; we listen to the same query key
 * indirectly through `useClaudeAuthStatus`).
 */
export function AuthRecoveryCard() {
  const { data: authStatus } = useClaudeAuthStatus();
  const { activeView } = useDashboard();
  const isLoggedIn = authStatus?.loggedIn === true;

  const { data, refetch } = useQuery({
    queryKey: STUCK_KEY,
    queryFn: () => api.get<{ sessions: StuckSession[] }>('/claude-auth/stuck-sessions'),
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    staleTime: 10_000,
    // Only fetch when there's any auth status known. The card doesn't
    // need to run before the user has even hit a chat.
    enabled: authStatus !== undefined,
  });

  // Exclude the chat the user is currently viewing — its in-chat banner
  // already offers the Resend action, so listing it here would duplicate
  // the affordance and add noise. The card is purely the "other stuck
  // chats" surface.
  const allSessions = data?.sessions ?? [];
  const sessions = allSessions.filter((s) => s.id !== activeView);
  const sessionIdsKey = sessions.map((s) => s.id).join(',');

  // Dismissal is per-set-of-stuck-sessions: once the user closes the
  // card, it stays gone for THAT set. If a new session joins the list,
  // we reset dismissal so the card pops back up.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  useEffect(() => {
    if (dismissedKey === null) return;
    if (sessionIdsKey !== dismissedKey) setDismissedKey(null);
  }, [dismissedKey, sessionIdsKey]);

  // After login flips to logged-in, refetch immediately to populate the
  // card. Polling would catch it within 30s anyway, but this avoids the
  // visible lag.
  useEffect(() => {
    if (isLoggedIn) refetch();
  }, [isLoggedIn, refetch]);

  const visible = isLoggedIn && sessions.length > 0 && dismissedKey !== sessionIdsKey;
  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Sessions paused for login"
      className="fixed bottom-4 right-4 z-50 w-[340px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-background shadow-lg"
    >
      <CardHeader
        count={sessions.length}
        onClose={() => setDismissedKey(sessionIdsKey)}
      />
      <div className="max-h-[360px] overflow-y-auto">
        {sessions.map((s) => (
          <StuckSessionRow key={s.id} session={s} />
        ))}
      </div>
      {sessions.length > 1 && <CardFooter sessions={sessions} />}
    </div>
  );
}

function CardHeader({ count, onClose }: { count: number; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-2">
      <div className="text-[12px] font-medium">
        {count} session{count === 1 ? '' : 's'} paused
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X size={12} />
      </button>
    </div>
  );
}

function StuckSessionRow({ session }: { session: StuckSession }) {
  const { setActiveView } = useDashboard();
  const qc = useQueryClient();
  const resend = useMutation({
    mutationFn: () =>
      sessionsApi.sendMessage(session.id, session.lastUserMessage?.content ?? '', {
        attachments: session.lastUserMessage?.attachments ?? undefined,
      }),
    onSuccess: () => {
      // Drop this session from the card by refetching. The new user
      // message + agent reply will push the auth_required event out of
      // "latest event" position.
      qc.invalidateQueries({ queryKey: STUCK_KEY });
      qc.invalidateQueries({ queryKey: ['session', session.id] });
    },
  });

  const label = session.label?.trim() || 'Untitled session';
  const preview = session.lastUserMessage?.content?.trim() ?? '';
  const canResend = !!session.lastUserMessage && !!preview;

  return (
    <div className="flex items-start gap-2 border-b border-border/60 px-3 py-2 last:border-b-0">
      <button
        type="button"
        onClick={() => setActiveView(session.id)}
        className="flex-1 min-w-0 text-left"
      >
        <div className="flex items-center gap-1 text-[12px] font-medium text-foreground truncate">
          <ChevronRight size={11} className="shrink-0 text-muted-foreground/60" />
          <span className="truncate">{label}</span>
        </div>
        {preview && (
          <div className="mt-0.5 ml-3.5 text-[11px] text-muted-foreground line-clamp-2">
            &ldquo;{preview}&rdquo;
          </div>
        )}
      </button>
      {canResend && (
        <button
          type="button"
          onClick={() => resend.mutate()}
          disabled={resend.isPending}
          className={cn(
            'shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium',
            'bg-foreground text-background hover:bg-foreground/90',
            'disabled:opacity-60 disabled:cursor-not-allowed',
          )}
          title="Resend the last message in this session"
        >
          {resend.isPending ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <RefreshCw size={10} />
          )}
          <span>Resend</span>
        </button>
      )}
    </div>
  );
}

function CardFooter({ sessions }: { sessions: StuckSession[] }) {
  const qc = useQueryClient();
  const resendAll = useMutation({
    mutationFn: async () => {
      // Sequential rather than parallel — each dispatch flips
      // runningSessions on the executor, and sending two messages into
      // the same session simultaneously would 409 the second one. They
      // ARE different sessions here so parallel would technically work,
      // but sequential is friendlier to the executor and keeps error
      // semantics clean.
      for (const s of sessions) {
        if (!s.lastUserMessage || !(s.lastUserMessage.content ?? '').trim()) continue;
        try {
          await sessionsApi.sendMessage(s.id, s.lastUserMessage.content, {
            attachments: s.lastUserMessage.attachments,
          });
        } catch {
          // One failure shouldn't abort the rest. The card will refresh
          // and show the survivors.
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: STUCK_KEY });
      qc.invalidateQueries({ queryKey: ['session'] });
    },
  });

  return (
    <div className="border-t border-border px-3 py-2">
      <button
        type="button"
        onClick={() => resendAll.mutate()}
        disabled={resendAll.isPending}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-[11px] font-medium hover:bg-muted/70 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {resendAll.isPending ? (
          <>
            <Loader2 size={11} className="animate-spin" />
            <span>Resending all…</span>
          </>
        ) : (
          <>
            <RefreshCw size={11} />
            <span>Resend all</span>
          </>
        )}
      </button>
    </div>
  );
}
