'use client';

import { useState } from 'react';
import {
  ChevronRight, AlertTriangle, CheckCircle2, Wrench, RefreshCw, Sparkles,
  ShieldCheck, ShieldAlert, HelpCircle, LogIn, Loader2,
} from 'lucide-react';
import { useClaudeLogin, useClaudeAuthStatus } from '@/hooks/use-claude-login';
import { useSessionEvents, useRetrySend } from '@/hooks/use-execution';
import type { ClientEventStatus } from '@/hooks/use-execution';
import { useMutation } from '@tanstack/react-query';
import { sessionsApi } from '@/lib/api/sessions';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { VoiceSentBadge } from '@/components/chat/voice-sent-badge';
import { CopyMessageButton } from '@/components/chat/copy-message-button';
import { MessageFileChip } from '@/components/chat/message-file-chip';
import { MessageEntityChip, type EntityLookup } from '@/components/chat/message-entity-chip';
import {
  parseEntitySegments,
  type EntityMarker,
  type EntitySegment,
} from '@/lib/entity-refs/parse-markers';
import { useSessionEntities, useScratchpad } from '@/hooks/use-execution';
import { dispatchOpenReference } from '@/lib/entity-refs/open-event';
import { cn } from '@/lib/utils';
import type { ChatEventRecord, Attachment } from '@/db/types';

interface ExecutionEventProps {
  event: ChatEventRecord;
  /** Owning session id — needed for actions that re-dispatch into the session. */
  sessionId?: string;
  /** True when this is the literal last event in the transcript. */
  isLast?: boolean;
  /**
   * True when this event represents an unresolved condition that the
   * user still needs to act on. Computed by the transcript (e.g., an
   * `auth_required` with no subsequent user message). Distinct from
   * `isLast` because trailing system/result events from the same failed
   * turn shouldn't demote the actionable state.
   */
  isLatestUnresolved?: boolean;
  /** True when this client sent the message via voice this session. */
  voiceSent?: boolean;
  /**
   * Client-only status overlay for optimistic user messages. Present
   * only while a POST is in flight or has failed; cleared once the
   * persisted row arrives. Drives the failed-bubble retry CTA so the
   * user knows their send didn't reach the DB.
   */
  clientStatus?: ClientEventStatus;
}

/**
 * Render a single chat_events row by its `source`. Source enum values
 * (defined in chat-sessions.md) discriminate styling:
 *
 *   - user / agent — wrap in AI Elements `Message` so we get the same
 *     bubble styling as the rest of the app.
 *   - thinking — collapsed dim italic with expand affordance.
 *   - tool_call / tool_result — collapsible cards, paired visually.
 *   - system / result / recap / rate_limit / error / unknown — bespoke.
 */
export function ExecutionEvent({ event, sessionId, isLast, isLatestUnresolved, voiceSent, clientStatus }: ExecutionEventProps) {
  const [expanded, setExpanded] = useState(false);

  switch (event.source) {
    case 'user': {
      const content = event.content ?? '';
      const segments = parseEntitySegments(content);
      const hasMarkers = segments.some((s) => s.kind === 'marker');
      const isFailed = clientStatus?.status === 'failed';
      const isSending = clientStatus?.status === 'sending';
      return (
        <div className="group flex flex-col">
          <Message from="user">
            <MessageContent
              className={cn(
                'text-[12.5px] whitespace-pre-wrap break-words',
                isFailed && 'opacity-70 border border-destructive/40',
              )}
            >
              {hasMarkers ? (
                <RenderMessageSegments
                  segments={segments}
                  attachments={event.attachments ?? []}
                  sessionId={sessionId}
                />
              ) : (
                content
              )}
            </MessageContent>
          </Message>
          {voiceSent && <VoiceSentBadge />}
          {isFailed && sessionId && (
            <FailedSendBadge sessionId={sessionId} eventId={event.id} error={clientStatus?.error} />
          )}
          {isSending && (
            <div className="self-end mt-0.5 flex items-center gap-1 text-[10.5px] text-muted-foreground/70">
              <Loader2 size={10} className="animate-spin" />
              <span>Sending…</span>
            </div>
          )}
          {event.content && (
            <CopyMessageButton
              text={event.content}
              align="right"
              timestamp={event.createdAt}
            />
          )}
        </div>
      );
    }

    case 'agent':
      return (
        <div className="group flex flex-col">
          <Message from="assistant">
            <MessageContent className="text-[12.5px] leading-relaxed">
              <MessageResponse className="text-[12.5px] [&_p]:text-[12.5px] [&_li]:text-[12.5px] [&_code]:text-[11px]">
                {event.content ?? ''}
              </MessageResponse>
            </MessageContent>
          </Message>
          {event.content && (
            <CopyMessageButton
              text={event.content}
              align="left"
              alwaysVisible
              timestamp={event.createdAt}
            />
          )}
        </div>
      );

    case 'thinking': {
      const content = event.content ?? '';
      return (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full text-left text-[11px] text-muted-foreground/80 italic"
        >
          <div className="flex items-center gap-1.5">
            <ChevronRight size={11} className={cn('transition-transform', expanded && 'rotate-90')} />
            <Sparkles size={11} className="opacity-60" />
            <span>{expanded ? 'Thinking' : `Thinking — ${truncate(content, 80) || '…'}`}</span>
          </div>
          {expanded && (
            <div className="mt-1.5 ml-5 pl-3 border-l border-border/60 whitespace-pre-wrap break-words">
              {content}
            </div>
          )}
        </button>
      );
    }

    case 'tool_call': {
      const name = event.toolName ?? 'tool';
      const summary = summarizeToolInput(event.toolInput);
      return (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full text-left rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-1.5 text-[11px]">
            <ChevronRight size={11} className={cn('transition-transform text-muted-foreground/60', expanded && 'rotate-90')} />
            <Wrench size={11} className="text-muted-foreground/70" />
            <span className="font-mono font-medium text-foreground">{name}</span>
            {summary && <span className="text-muted-foreground/70 truncate">{summary}</span>}
          </div>
          {expanded && event.toolInput != null && (
            <pre className="mt-2 ml-5 text-[10.5px] text-muted-foreground bg-background/60 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
              {JSON.stringify(event.toolInput, null, 2)}
            </pre>
          )}
        </button>
      );
    }

    case 'tool_result': {
      const isError = event.toolIsError === true;
      const text = event.content ?? '';
      return (
        <button
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            'w-full text-left rounded-md px-2.5 py-1.5 transition-colors',
            isError
              ? 'border border-destructive/30 bg-destructive/5 hover:bg-destructive/10'
              : 'border border-border/40 bg-background hover:bg-muted/30',
          )}
        >
          <div className="flex items-center gap-1.5 text-[11px]">
            <ChevronRight size={11} className={cn('transition-transform text-muted-foreground/60', expanded && 'rotate-90')} />
            {isError ? (
              <AlertTriangle size={11} className="text-destructive" />
            ) : (
              <CheckCircle2 size={11} className="text-muted-foreground/70" />
            )}
            <span className={cn(isError ? 'text-destructive' : 'text-muted-foreground/80')}>
              {isError ? 'Tool error' : 'Tool result'}
              {!expanded && text && (
                <span className="text-muted-foreground/60 ml-1.5 font-normal">— {truncate(text, 80)}</span>
              )}
            </span>
          </div>
          {expanded && text && (
            <pre className="mt-2 ml-5 text-[10.5px] text-muted-foreground whitespace-pre-wrap wrap-anywhere font-mono">
              {text}
            </pre>
          )}
        </button>
      );
    }

    case 'system':
      return (
        <div className="flex items-center gap-2 my-1 text-[10px] text-muted-foreground/70">
          <div className="flex-1 h-px bg-border/60" />
          <span className="italic">{event.content ?? 'system'}</span>
          <div className="flex-1 h-px bg-border/60" />
        </div>
      );

    case 'rate_limit':
      return (
        <div className="flex">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 text-amber-500 px-2.5 py-0.5 text-[10.5px] font-medium">
            {event.content ?? 'Rate limit'}
          </div>
        </div>
      );

    case 'error':
      return (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle size={11} />
            <span>Error</span>
          </div>
          {event.content && <div className="mt-1 text-foreground/80">{event.content}</div>}
        </div>
      );

    case 'auth_required':
      return (
        <AuthRequiredBanner
          event={event}
          sessionId={sessionId}
          isActionable={isLatestUnresolved ?? false}
        />
      );

    case 'recap':
      return (
        <div className="flex items-center gap-2 my-2 text-[10px] text-muted-foreground/80">
          <div className="flex-1 h-px bg-border" />
          <RefreshCw size={11} />
          <span>{event.content ?? 'Resumed'}</span>
          <div className="flex-1 h-px bg-border" />
        </div>
      );

    case 'permission_request': {
      const tool = event.toolName ?? 'tool';
      const summary = summarizeToolInput(event.toolInput);
      return (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 text-[11px]">
            <ShieldCheck size={11} className="text-blue-500" />
            <span className="text-foreground/90">Permission requested</span>
            <span className="text-muted-foreground/60 font-mono">— {tool}</span>
            {summary && <span className="text-muted-foreground/70 truncate">{summary}</span>}
          </div>
          {event.content && (
            <div className="mt-1 ml-5 text-[11px] text-muted-foreground/80">
              {event.content}
            </div>
          )}
        </div>
      );
    }

    case 'permission_response': {
      const allowed = !event.toolIsError;
      return (
        <div
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10.5px] font-medium',
            allowed
              ? 'bg-emerald-500/10 text-emerald-500'
              : 'bg-destructive/10 text-destructive',
          )}
        >
          {allowed ? <ShieldCheck size={11} /> : <ShieldAlert size={11} />}
          <span>{allowed ? 'Allowed' : 'Denied'}</span>
          {event.content && event.content !== (allowed ? 'allowed' : 'denied') && (
            <span className="font-normal opacity-80">— {event.content}</span>
          )}
        </div>
      );
    }

    case 'question_request': {
      const questions = extractQuestions(event.toolInput);
      const first = questions[0];
      return (
        <div className="rounded-md border border-foreground/20 bg-foreground/5 px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 text-[11px]">
            <HelpCircle size={11} className="text-foreground/80" />
            <span className="text-foreground/90">Question</span>
            {questions.length > 1 && (
              <span className="text-muted-foreground/70">({questions.length} parts)</span>
            )}
          </div>
          {first && (
            <div className="mt-1 ml-5 text-[11px] text-muted-foreground/80">
              {first.header || first.question}
            </div>
          )}
        </div>
      );
    }

    case 'question_response': {
      const text = event.content ?? '';
      return (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full text-left rounded-md border border-foreground/15 bg-foreground/5 px-2.5 py-1.5"
        >
          <div className="flex items-center gap-1.5 text-[11px]">
            <ChevronRight
              size={11}
              className={cn('transition-transform text-muted-foreground/60', expanded && 'rotate-90')}
            />
            <HelpCircle size={11} className="text-foreground/80" />
            <span className="text-foreground/90">Your answer</span>
            {!expanded && text && (
              <span className="text-muted-foreground/70 truncate">— {truncate(text, 80)}</span>
            )}
          </div>
          {expanded && text && (
            <pre className="mt-1.5 ml-5 text-[10.5px] text-muted-foreground whitespace-pre-wrap break-words">
              {text}
            </pre>
          )}
        </button>
      );
    }

    default:
      // `unknown` (agentex forward-compat fallback) and any other
      // source the transcript doesn't have explicit styling for is
      // internal noise — the user should never see "[unknown] …" in
      // their chat feed. The row is still persisted in chat_events
      // for debugging via the raw JSON, just not rendered.
      return null;
  }
}

/**
 * Inline marker for an `auth_required` event. Two visual modes:
 *
 *   - **Actionable** (`isActionable={true}`): full amber callout with
 *     reason copy and a button. Button morphs by state:
 *       - not logged in: "Log in"
 *       - logged in: "Resend" (re-dispatches the last user message)
 *
 *   - **Historical** (`isActionable={false}`): single-line muted chip,
 *     no button. Shown when the user has moved past this event (sent
 *     another message after it). Keeps the historical record without
 *     visually crowding the transcript.
 *
 * `isActionable` is computed at the transcript level (see
 * `ExecutionTranscript`) — it tracks "is there an unresolved auth issue
 * here that the user still needs to address," not just "is this the
 * last row." Trailing system / result events from the same failed turn
 * don't demote the actionable state.
 */
function AuthRequiredBanner({
  event,
  sessionId,
  isActionable,
}: {
  event: ChatEventRecord;
  sessionId?: string;
  isActionable: boolean;
}) {
  const login = useClaudeLogin();
  const { data: authStatus } = useClaudeAuthStatus();
  const isLoggedIn = authStatus?.loggedIn === true;

  const meta = (event.toolInput ?? {}) as {
    httpStatus?: number | null;
    reason?: string | null;
    loginCommand?: string | null;
    providerType?: string | null;
  };
  const providerLabel = formatProviderLabel(meta.providerType);

  // Historical: tiny muted chip, no button. The event is preserved for
  // transcript completeness but reframed positively — by the time it's
  // demoted to historical, the user has already moved past it (sent
  // another message after re-authing), so the user-facing read is "yep,
  // we're logged in to <agent>." Soft check icon, no warning color.
  if (!isActionable) {
    return (
      <div className="flex items-center gap-1.5 my-1 text-[10px] text-muted-foreground/70">
        <div className="flex-1 h-px bg-border/40" />
        <ShieldCheck size={10} className="opacity-70" />
        <span>Logged in to {providerLabel}</span>
        <div className="flex-1 h-px bg-border/40" />
      </div>
    );
  }
  const reason = meta.reason ?? null;
  const sublabel = (() => {
    switch (reason) {
      case 'expired': return 'Your access token expired.';
      case 'revoked': return 'Your access token was revoked.';
      case 'missing': return 'No credentials found for Claude.';
      case 'scope':   return 'Your token is missing a required scope.';
      case 'disabled_org': return 'Your API key belongs to a disabled organization.';
      case 'routines_disabled': return 'Routines are disabled by your org policy.';
      case 'invalid': return 'Your credentials were rejected.';
      default:        return event.content ?? 'Claude needs to log in again.';
    }
  })();

  const errorMessage = login.error
    ? (login.error.message || 'Login failed — try again.')
    : null;

  // Two distinct visual states for the actionable banner:
  // - Logged in: auth's been restored (either via our button or
  //   out-of-band). The only remaining action is to retry the message
  //   that originally failed. Calm, green-tinted.
  // - Logged out: the original failure state. Loud, amber.
  if (isLoggedIn && !!sessionId) {
    return (
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px]">
        <div className="flex items-start gap-2">
          <ShieldCheck size={12} className="mt-0.5 text-emerald-500" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground">Authentication restored</div>
            <div className="mt-0.5 text-muted-foreground">
              Resend your message to continue.
            </div>
          </div>
          <ResendLastMessageButton sessionId={sessionId} />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px]">
      <div className="flex items-start gap-2">
        <AlertTriangle size={12} className="mt-0.5 text-amber-500" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-foreground">Claude needs to log in again</div>
          <div className="mt-0.5 text-muted-foreground">{sublabel}</div>
          {errorMessage && (
            <div className="mt-1 text-destructive">{errorMessage}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => login.mutate()}
          disabled={login.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background px-2.5 py-1 text-[11px] font-medium hover:bg-foreground/90 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {login.isPending ? (
            <>
              <Loader2 size={11} className="animate-spin" />
              <span>Waiting for login…</span>
            </>
          ) : (
            <>
              <LogIn size={11} />
              <span>Log in</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Re-dispatches the most recent user-source event back into the session.
 * Lives next to the banner — the user's last typed message is what
 * Claude rejected, and now that auth is restored, sending the same bytes
 * again is the natural recovery.
 *
 * Reads from the existing useSessionEvents cache, so no extra network
 * call to find the message content.
 */
function ResendLastMessageButton({ sessionId }: { sessionId: string }) {
  const { data: events } = useSessionEvents(sessionId);
  const lastUser = useLastUserEvent(events);
  const resend = useMutation({
    mutationFn: () =>
      sessionsApi.sendMessage(sessionId, lastUser?.content ?? '', {
        attachments: lastUser?.attachments ?? undefined,
      }),
  });

  if (!lastUser || !(lastUser.content ?? '').trim()) return null;

  return (
    <button
      type="button"
      onClick={() => resend.mutate()}
      disabled={resend.isPending}
      className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background px-2.5 py-1 text-[11px] font-medium hover:bg-foreground/90 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {resend.isPending ? (
        <>
          <Loader2 size={11} className="animate-spin" />
          <span>Resending…</span>
        </>
      ) : (
        <>
          <RefreshCw size={11} />
          <span>Resend</span>
        </>
      )}
    </button>
  );
}

/**
 * Inline retry affordance under a user bubble whose POST never reached
 * the DB. The optimistic placeholder is still in cache (we no longer
 * silently roll it back); this badge re-fires the same eventId so the
 * same DOM node transitions failed → sending → sent.
 */
function FailedSendBadge({
  sessionId,
  eventId,
  error,
}: {
  sessionId: string;
  eventId: string;
  error?: string;
}) {
  const retry = useRetrySend(sessionId);
  return (
    <div className="self-end mt-0.5 flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-destructive">
        <AlertTriangle size={11} />
        <span>{error ? `Send failed — ${error}` : 'Send failed'}</span>
      </div>
      <button
        type="button"
        onClick={() => retry.mutate({ eventId })}
        disabled={retry.isPending}
        className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-1.5 py-0.5 text-[10.5px] text-destructive hover:bg-destructive/10 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {retry.isPending ? (
          <>
            <Loader2 size={10} className="animate-spin" />
            <span>Retrying…</span>
          </>
        ) : (
          <>
            <RefreshCw size={10} />
            <span>Retry</span>
          </>
        )}
      </button>
    </div>
  );
}

function useLastUserEvent(events: ChatEventRecord[] | undefined): ChatEventRecord | null {
  if (!events) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].source === 'user') return events[i];
  }
  return null;
}

/**
 * Friendly display name for a provider type emitted by agentex. Falls
 * back to "Claude" when missing (the only provider currently emitting
 * `auth_required` end-to-end), and to a title-cased version of whatever
 * else shows up for forward-compat.
 */
function formatProviderLabel(providerType: string | null | undefined): string {
  switch (providerType) {
    case 'claude': return 'Claude';
    case 'codex': return 'Codex';
    case 'gemini': return 'Gemini';
    case 'cursor': return 'Cursor';
    case 'opencode': return 'OpenCode';
    case null:
    case undefined:
    case '':
      return 'Claude';
    default:
      return providerType.charAt(0).toUpperCase() + providerType.slice(1);
  }
}

function truncate(str: string, max: number): string {
  const trimmed = str.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? trimmed.slice(0, max - 1) + '…' : trimmed;
}

function summarizeToolInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return truncate(input, 60);
  if (typeof input === 'object') {
    const o = input as Record<string, unknown>;
    for (const key of ['file_path', 'path', 'command', 'pattern', 'url', 'query']) {
      const v = o[key];
      if (typeof v === 'string') return truncate(v, 60);
    }
    return truncate(JSON.stringify(o), 60);
  }
  return '';
}

interface MinimalQuestion { question: string; header?: string }

function extractQuestions(input: unknown): MinimalQuestion[] {
  if (!input || typeof input !== 'object') return [];
  const wrapper = input as { questions?: unknown };
  const arr = wrapper.questions;
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (q): q is MinimalQuestion =>
      !!q && typeof q === 'object' && typeof (q as MinimalQuestion).question === 'string',
  );
}

/**
 * Render a message body that contains entity markers. Splits the
 * string into segments, swaps file markers for `MessageFileChip` (kept
 * for the existing image / text / download UX) and task/note/scratchpad
 * markers for `MessageEntityChip`. Tasks/notes look up against
 * `useSessionEntities`; the scratchpad text comes from `useScratchpad`.
 */
function RenderMessageSegments({
  segments,
  attachments,
  sessionId,
}: {
  segments: EntitySegment[];
  attachments: Attachment[];
  sessionId?: string;
}) {
  const entitiesQuery = useSessionEntities(sessionId ?? null);
  const scratchpadQuery = useScratchpad(sessionId ?? null);
  const attachmentMap = new Map(attachments.map((a) => [a.fileName, a]));

  const lookup: EntityLookup = {
    tasksById: new Map((entitiesQuery.data?.tasks ?? []).map((t) => [t.id, t])),
    notesById: new Map((entitiesQuery.data?.notes ?? []).map((n) => [n.id, n])),
    scratchpad: scratchpadQuery.data?.scratchPad ?? null,
  };

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === 'text') {
          return <span key={i}>{seg.text}</span>;
        }
        const m = seg.marker;
        if (m.kind === 'file') {
          const att = attachmentMap.get(m.fileName);
          // Unknown attachment — fall back to literal token.
          return att ? <MessageFileChip key={i} attachment={att} /> : <span key={i}>{seg.raw}</span>;
        }
        return (
          <MessageEntityChip
            key={i}
            marker={m}
            lookup={lookup}
            onOpen={(marker) => dispatchOpenReference(marker)}
          />
        );
      })}
    </>
  );
}
