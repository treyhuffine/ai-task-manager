'use client';

import { useState } from 'react';
import {
  ChevronRight, AlertTriangle, CheckCircle2, Wrench, RefreshCw, Sparkles,
  ShieldCheck, ShieldAlert, HelpCircle,
} from 'lucide-react';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { VoiceSentBadge } from '@/components/chat/voice-sent-badge';
import { CopyMessageButton } from '@/components/chat/copy-message-button';
import { MessagePasteChip } from '@/components/chat/message-paste-chip';
import { parsePasteMarkers } from '@/components/chat/editor/parse-paste-markers';
import { cn } from '@/lib/utils';
import type { ChatEventWithAttachments } from '@/db/types';

interface ExecutionEventProps {
  event: ChatEventWithAttachments;
  /** True when this client sent the message via voice this session. */
  voiceSent?: boolean;
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
export function ExecutionEvent({ event, voiceSent }: ExecutionEventProps) {
  const [expanded, setExpanded] = useState(false);

  switch (event.source) {
    case 'user': {
      const segments = parsePasteMarkers(event.content ?? '', event.pasted_attachments ?? []);
      const hasChips = segments.some((s) => s.kind === 'chip');
      return (
        <div className="group flex flex-col">
          <Message from="user">
            <MessageContent className="text-[12.5px] whitespace-pre-wrap break-words">
              {hasChips ? (
                segments.map((seg, i) =>
                  seg.kind === 'text' ? (
                    <span key={i}>{seg.text}</span>
                  ) : (
                    <MessagePasteChip
                      key={i}
                      filename={seg.filename}
                      content={seg.content}
                    />
                  ),
                )
              ) : (
                event.content ?? ''
              )}
            </MessageContent>
          </Message>
          {voiceSent && <VoiceSentBadge />}
          {event.content && (
            <CopyMessageButton
              text={event.content}
              align="right"
              timestamp={event.created_at}
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
              timestamp={event.created_at}
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
      const name = event.tool_name ?? 'tool';
      const summary = summarizeToolInput(event.tool_input);
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
          {expanded && event.tool_input != null && (
            <pre className="mt-2 ml-5 text-[10.5px] text-muted-foreground bg-background/60 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
              {JSON.stringify(event.tool_input, null, 2)}
            </pre>
          )}
        </button>
      );
    }

    case 'tool_result': {
      const isError = event.tool_is_error === true;
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
            <pre className="mt-2 ml-5 text-[10.5px] text-muted-foreground whitespace-pre-wrap break-words font-mono">
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

    case 'result':
      return (
        <div className="flex">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-500 px-2.5 py-0.5 text-[10.5px] font-medium">
            <CheckCircle2 size={11} />
            {event.content ?? 'Run complete'}
          </div>
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
      const tool = event.tool_name ?? 'tool';
      const summary = summarizeToolInput(event.tool_input);
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
      const allowed = !event.tool_is_error;
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
      const questions = extractQuestions(event.tool_input);
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
      return (
        <div className="text-[10.5px] text-muted-foreground/60 italic">
          [{event.source}] {event.content ?? ''}
        </div>
      );
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
