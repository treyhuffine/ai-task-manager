'use client';

import { useRef, useState } from 'react';
import {
  HelpCircle, ShieldCheck, Wrench, Check, ChevronRight, Loader2,
} from 'lucide-react';
import { usePendingInput, useResolvePendingInput } from '@/hooks/use-execution';
import { cn } from '@/lib/utils';
import type {
  PendingInput, PendingPermission, PendingQuestion, AskUserQuestionItem,
} from '@/lib/api/sessions';

// Sentinel label for the auto-appended "Other" choice. Matches Claude
// Code's `__other__` value so this codebase reads the same pattern.
const OTHER_VALUE = '__other__';

interface PendingInputAreaProps {
  sessionId: string;
}

/**
 * Inline area shown above the composer when the agent is waiting for
 * the user — either a structured question (`AskUserQuestion`) or a
 * tool permission request. Renders nothing when there's nothing pending
 * so the composer sits flush against the transcript.
 *
 * Lives in normal layout flow (not absolute) so the transcript above
 * is never obscured: stick-to-bottom auto-pins the conversation just
 * above this card. If the user scrolls up to look at history, this
 * card stays anchored at the bottom of the viewport with the composer.
 *
 * We render the most recent pending entry. If multiple stack up, the
 * older ones queue behind and surface in turn as the user resolves the
 * top one. Claude rarely emits more than one approval at a time, and
 * a stack of cards would compete with the transcript for attention.
 */
export function PendingInputArea({ sessionId }: PendingInputAreaProps) {
  const { data: pending } = usePendingInput(sessionId);
  if (!pending || pending.length === 0) return null;

  const top = pending[pending.length - 1];

  return (
    <div className="flex-shrink-0">
      <div className="px-5 pt-3 pb-1 max-w-3xl mx-auto">
        {top.kind === 'question' ? (
          <QuestionCard key={top.requestId} pending={top} sessionId={sessionId} />
        ) : (
          <PermissionCard key={top.requestId} pending={top} sessionId={sessionId} />
        )}
        {pending.length > 1 && (
          <div className="text-[10px] text-muted-foreground/70 mt-1 text-center">
            +{pending.length - 1} more pending
          </div>
        )}
      </div>
    </div>
  );
}

/** Back-compat re-export — older imports may still use the overlay name. */
export const PendingInputOverlay = PendingInputArea;

// ─── Question card ────────────────────────────────────────────

function QuestionCard({
  pending,
  sessionId,
}: {
  pending: PendingQuestion;
  sessionId: string;
}) {
  const resolve = useResolvePendingInput(sessionId);
  // For each question index: which structured-option labels are selected
  // and (separately) what the user typed into the Other input. Other
  // counts as an answer when the typed text is non-empty.
  const [selections, setSelections] = useState<Record<number, string[]>>({});
  const [otherText, setOtherText] = useState<Record<number, string>>({});
  const [currentIdx, setCurrentIdx] = useState(0);
  const otherInputRef = useRef<HTMLInputElement | null>(null);

  const q = pending.questions[currentIdx] as AskUserQuestionItem | undefined;
  if (!q) return null;

  const isMulti = q.multiSelect ?? false;
  const selected = selections[currentIdx] ?? [];
  const otherTyped = otherText[currentIdx] ?? '';
  const otherActive = selected.includes(OTHER_VALUE);
  const isLast = currentIdx === pending.questions.length - 1;

  // A question counts as answered if the user picked a structured
  // option OR typed something in Other. This drives the Submit gate.
  const isQuestionAnswered = (i: number) => {
    const s = selections[i] ?? [];
    const t = (otherText[i] ?? '').trim();
    if (s.includes(OTHER_VALUE)) return t.length > 0;
    return s.length > 0;
  };
  const allAnswered = pending.questions.every((_, i) => isQuestionAnswered(i));
  const currentAnswered = isQuestionAnswered(currentIdx);

  const toggleOption = (label: string) => {
    setSelections((prev) => {
      const current = prev[currentIdx] ?? [];
      if (isMulti) {
        const next = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
        return { ...prev, [currentIdx]: next };
      }
      return { ...prev, [currentIdx]: [label] };
    });
    if (label === OTHER_VALUE) {
      // Auto-focus the Other input the moment the user picks it. Stays
      // out of the way otherwise — focusing on every render would steal
      // focus from the textarea each time an SSE frame updates the cache.
      requestAnimationFrame(() => otherInputRef.current?.focus());
    }
  };

  const submit = async () => {
    const answers: Record<string, string> = {};
    for (let i = 0; i < pending.questions.length; i++) {
      const item = pending.questions[i]!;
      const sel = selections[i] ?? [];
      const t = (otherText[i] ?? '').trim();
      // Replace the OTHER_VALUE sentinel with the typed text. A bare
      // "Other" selection without text shouldn't slip through; the
      // gate above prevents submit in that case.
      const labels = sel.flatMap((s) => (s === OTHER_VALUE ? (t ? [t] : []) : [s]));
      answers[item.question] = labels.join(', ');
    }
    await resolve.mutateAsync({
      requestId: pending.requestId,
      body: { allow: true, answers },
    });
  };

  const handleNext = () => {
    if (isLast) submit();
    else setCurrentIdx((i) => i + 1);
  };

  return (
    <div className="rounded-xl border border-foreground/20 bg-card overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-200">
      <div className="flex items-center gap-2.5 px-3.5 py-2 bg-foreground/5 border-b border-foreground/15">
        <HelpCircle size={12} className="text-foreground/80 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[11.5px] font-semibold text-foreground truncate">
            Agent needs your input
          </div>
        </div>
        {pending.questions.length > 1 && (
          <span className="text-[10px] text-muted-foreground/70">
            {currentIdx + 1}/{pending.questions.length}
          </span>
        )}
        {isMulti && (
          <span className="text-[9px] uppercase tracking-wider text-foreground/70 font-semibold px-1.5 py-0.5 rounded bg-foreground/10 border border-foreground/20">
            multi
          </span>
        )}
      </div>

      <div className="px-4 pt-3 pb-2">
        <div className="text-[13px] font-medium text-foreground leading-snug">
          {q.header || q.question}
        </div>
        {q.header && q.header !== q.question && (
          <div className="text-[12px] text-muted-foreground mt-0.5">{q.question}</div>
        )}
      </div>

      <div className="px-4 pb-3 flex flex-col gap-1.5">
        {q.options.map((opt) => {
          const isSelected = selected.includes(opt.label);
          return (
            <button
              key={opt.label}
              type="button"
              onClick={() => toggleOption(opt.label)}
              className={cn(
                'flex items-start gap-2.5 px-3 py-2 rounded-lg text-left transition-all border',
                isSelected
                  ? 'bg-primary/10 border-primary/40 text-foreground'
                  : 'bg-background border-border hover:border-foreground/30 hover:bg-muted/30 text-foreground/90',
              )}
            >
              <div
                className={cn(
                  'mt-0.5 w-4 h-4 flex items-center justify-center shrink-0 transition-colors border-2',
                  isMulti ? 'rounded' : 'rounded-full',
                  isSelected ? 'border-primary bg-primary' : 'border-border',
                )}
              >
                {isSelected && <Check size={10} className="text-primary-foreground" strokeWidth={3} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-medium leading-snug">{opt.label}</div>
                {opt.description && (
                  <div className="text-[11px] text-muted-foreground/80 mt-0.5 leading-snug">
                    {opt.description}
                  </div>
                )}
              </div>
            </button>
          );
        })}

        {/* "Other" — auto-appended free-form option. Selecting it
            reveals an input. Matches Claude Code (their schema tells
            the model "no Other option, that will be provided
            automatically"). Replaces the dismiss-X that used to live
            in the header — the Stop button on the composer is the
            mechanism for actually cancelling the agent. */}
        <button
          type="button"
          onClick={() => toggleOption(OTHER_VALUE)}
          className={cn(
            'flex items-start gap-2.5 px-3 py-2 rounded-lg text-left transition-all border',
            otherActive
              ? 'bg-primary/10 border-primary/40 text-foreground'
              : 'bg-background border-border hover:border-foreground/30 hover:bg-muted/30 text-foreground/90',
          )}
        >
          <div
            className={cn(
              'mt-0.5 w-4 h-4 flex items-center justify-center shrink-0 transition-colors border-2',
              isMulti ? 'rounded' : 'rounded-full',
              otherActive ? 'border-primary bg-primary' : 'border-border',
            )}
          >
            {otherActive && <Check size={10} className="text-primary-foreground" strokeWidth={3} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-medium leading-snug">Other</div>
            <div className="text-[11px] text-muted-foreground/80 mt-0.5 leading-snug">
              Type a free-form answer.
            </div>
          </div>
        </button>

        {otherActive && (
          <input
            ref={otherInputRef}
            type="text"
            value={otherTyped}
            onChange={(e) =>
              setOtherText((prev) => ({ ...prev, [currentIdx]: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' && currentAnswered && !resolve.isPending) {
                e.preventDefault();
                handleNext();
              }
            }}
            placeholder="Your answer…"
            disabled={resolve.isPending}
            className={cn(
              'w-full text-[12.5px] bg-background border border-primary/40 rounded-lg px-3 py-2',
              'text-foreground placeholder:text-muted-foreground/50',
              'focus:outline-none focus:border-primary/70',
              'disabled:opacity-60',
            )}
          />
        )}
      </div>

      <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/20">
        {pending.questions.length > 1 ? (
          <div className="flex gap-1">
            {pending.questions.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrentIdx(i)}
                className={cn(
                  'w-1.5 h-1.5 rounded-full transition-colors',
                  i === currentIdx
                    ? 'bg-primary'
                    : isQuestionAnswered(i)
                      ? 'bg-emerald-500'
                      : 'bg-muted-foreground/30',
                )}
                aria-label={`Go to question ${i + 1}`}
              />
            ))}
          </div>
        ) : (
          <div />
        )}

        <button
          type="button"
          disabled={!currentAnswered || resolve.isPending || (isLast && !allAnswered)}
          onClick={handleNext}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1 rounded-md text-[11.5px] font-medium transition-colors',
            'bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98]',
            'disabled:bg-muted disabled:text-muted-foreground/50 disabled:cursor-not-allowed',
          )}
        >
          {resolve.isPending ? (
            <><Loader2 size={11} className="animate-spin" /> Sending</>
          ) : isLast ? (
            <>Submit <Check size={11} /></>
          ) : (
            <>Next <ChevronRight size={11} /></>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Permission card ──────────────────────────────────────────

function PermissionCard({
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
            {pending.toolName}
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
        <ToolInputPreview toolName={pending.toolName} input={pending.input} />
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

function ToolInputPreview({
  toolName,
  input,
}: {
  toolName: string;
  input: Record<string, unknown>;
}) {
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
