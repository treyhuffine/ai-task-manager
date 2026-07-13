"use client";

/**
 * The digest: what triage did, rendered from applied outcomes (never from
 * plans). One block per pass, newest first. Every line is one tap from
 * undo, and re-route (accept the action, change the destination) is a
 * first-class affordance. Auto-applied work sits in a quiet section.
 * Calm vocabulary only (spec §1.10) — no counts as pressure, no jargon.
 */

import { useState } from 'react';
import {
  Check, Undo2, ChevronDown, ChevronRight, Sparkles, Target, FileText,
  BookOpen, Archive, Clock, CornerUpRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDashboard } from '@/contexts/dashboard-context';
import {
  useTriagePasses,
  useUndoDecision,
  useCorrectDecision,
  useMarkPassSeen,
  useStreamAutonomy,
  useSetStreamAutonomy,
} from '@/hooks/use-stream';
import type { TriageDecisionWithItems } from '@/lib/api/stream';
import type { TriageDisposition } from '@/db/types';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

function preview(text: string, n = 70): string {
  const line = text.trim().replace(/\s+/g, ' ');
  return line.length <= n ? line : line.slice(0, n - 1) + '…';
}

/** Outcome phrase per disposition, calm vocabulary. */
function decisionLine(d: TriageDecisionWithItems): { icon: typeof Target; text: string } {
  const itemText = d.items[0] ? preview(d.items[0].rawText, 50) : '';
  switch (d.disposition) {
    case 'promote_task':
      return { icon: Target, text: `Became a task: ${d.draft?.title ?? d.targetTitle ?? itemText}` };
    case 'promote_note':
      return { icon: FileText, text: `Became a note: ${d.draft?.title ?? d.targetTitle ?? itemText}` };
    case 'merge_task':
      return { icon: Target, text: `Added to ${d.targetTitle ?? 'a task'}` };
    case 'merge_note':
      return { icon: FileText, text: `Added to ${d.targetTitle ?? 'a note'}` };
    case 'combine_task':
      return { icon: Target, text: `${d.streamItemIds.length} thoughts became one task: ${d.draft?.title ?? d.targetTitle ?? ''}` };
    case 'combine_note':
      return { icon: FileText, text: `${d.streamItemIds.length} thoughts became one note: ${d.draft?.title ?? d.targetTitle ?? ''}` };
    case 'journal':
      return { icon: BookOpen, text: `Kept as a thought: ${itemText}` };
    case 'dismiss':
      return { icon: Archive, text: `Set aside: ${itemText}` };
    case 'incubate':
      return {
        icon: Clock,
        text: `Kept for later${d.draft?.resurfaceAt ? ` (back ${new Date(d.draft.resurfaceAt).toLocaleDateString()})` : ''}: ${itemText}`,
      };
  }
}

const REROUTE_OPTIONS: Array<{ disposition: TriageDisposition; label: string; icon: typeof Target }> = [
  { disposition: 'promote_task', label: 'Make it a task', icon: Target },
  { disposition: 'promote_note', label: 'Make it a note', icon: FileText },
  { disposition: 'journal', label: 'Keep as a thought', icon: BookOpen },
  { disposition: 'dismiss', label: 'Set aside', icon: Archive },
];

/** Re-route menu: accept the attention, change the destination. Richer
 *  signal than undo. Combines re-route per item, so it is hidden there. */
function RerouteMenu({ decision }: { decision: TriageDecisionWithItems }) {
  const correct = useCorrectDecision();
  const [open, setOpen] = useState(false);
  if (decision.streamItemIds.length > 1) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
          title="Change what happened"
        >
          <CornerUpRight size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-0" sideOffset={4}>
        <div className="py-1">
          {REROUTE_OPTIONS.filter((o) => o.disposition !== decision.disposition).map((o) => (
            <button
              key={o.disposition}
              onClick={() => {
                correct.mutate({
                  id: decision.id,
                  correction: { disposition: o.disposition, draft: decision.draft ?? null },
                });
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[10.5px] text-foreground hover:bg-muted transition-colors"
            >
              <o.icon size={11} className="text-muted-foreground" />
              {o.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DigestDecisionRow({ decision }: { decision: TriageDecisionWithItems }) {
  const { openTask, openNote } = useDashboard();
  const undo = useUndoDecision();
  const line = decisionLine(decision);
  const Icon = line.icon;
  const canOpen = decision.targetType && decision.targetId;
  const isUndone = decision.state === 'undone' || decision.state === 'corrected';

  return (
    <div className={cn('group flex items-center gap-2 py-1', isUndone && 'opacity-40 line-through')}>
      <Icon size={11} className="text-muted-foreground/70 flex-shrink-0" />
      <button
        className={cn(
          'flex-1 min-w-0 text-left text-[11px] leading-snug truncate',
          canOpen ? 'text-foreground hover:underline cursor-pointer' : 'text-foreground cursor-default',
        )}
        onClick={() => {
          if (!canOpen || isUndone) return;
          if (decision.targetType === 'task') openTask(decision.targetId!);
          else openNote(decision.targetId!);
        }}
      >
        {line.text}
      </button>
      {!isUndone && (
        <div className="flex items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex-shrink-0">
          <RerouteMenu decision={decision} />
          <button
            onClick={() => undo.mutate(decision.id)}
            className="p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
            title="Undo"
          >
            <Undo2 size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Standing graduation offers: the system asking for autonomy, the user
 *  answering. The only way autonomy goes up. */
function GraduationOffers() {
  const { data } = useStreamAutonomy();
  const setAutonomy = useSetStreamAutonomy();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const offers = (data?.offers ?? []).filter((o) => !dismissed.has(o.disposition));
  if (offers.length === 0) return null;
  return (
    <div className="mx-4 mt-3 space-y-2">
      {offers.map((offer) => (
        <div key={offer.disposition} className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <Sparkles size={12} className="text-primary mt-0.5 flex-shrink-0" />
            <p className="flex-1 text-[11px] leading-snug text-foreground">{offer.line}</p>
          </div>
          <div className="flex items-center gap-2 mt-2 ml-5">
            <button
              onClick={() => setAutonomy.mutate({ levels: { [offer.disposition]: offer.toLevel } })}
              className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[10px] font-semibold hover:bg-primary/90 transition-colors"
            >
              Yes, go ahead
            </button>
            <button
              onClick={() => setDismissed((prev) => new Set(prev).add(offer.disposition))}
              className="px-2.5 py-1 rounded-md text-[10px] text-muted-foreground hover:bg-muted transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function PassDigest({ passId }: { passId: string }) {
  const { data: passes } = useTriagePasses(10);
  const markSeen = useMarkPassSeen();
  const pass = passes?.find((p) => p.id === passId);
  const [expanded, setExpanded] = useState(!pass?.digestSeenAt);
  if (!pass) return null;

  const applied = pass.decisions.filter((d) => d.state === 'accepted' || d.state === 'corrected');
  const auto = pass.decisions.filter((d) => d.state === 'executed' || (d.state === 'undone' && d.passId === pass.id));
  const proposed = pass.decisions.filter((d) => d.state === 'proposed');
  const unseen = !pass.digestSeenAt;

  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5 transition-colors',
        unseen ? 'border-primary/25 bg-primary/[0.03]' : 'border-border bg-card/40',
      )}
    >
      <button
        className="w-full flex items-center gap-2 text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? (
          <ChevronDown size={11} className="text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight size={11} className="text-muted-foreground flex-shrink-0" />
        )}
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Triage {timeAgo(pass.completedAt ?? pass.createdAt)}
        </span>
        {unseen && <span className="w-1.5 h-1.5 rounded-full bg-primary/70" />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {pass.summary && (
            <p className="text-[11px] leading-relaxed text-foreground/90">{pass.summary}</p>
          )}

          {proposed.length > 0 && (
            <p className="text-[10.5px] text-primary font-medium">
              {proposed.length === 1 ? 'One thing needs your call.' : `${proposed.length} things need your call.`}
            </p>
          )}

          {applied.length > 0 && (
            <div>{applied.map((d) => <DigestDecisionRow key={d.id} decision={d} />)}</div>
          )}

          {auto.length > 0 && (
            <div className="pt-1 border-t border-border/60">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-0.5">
                Handled automatically
              </p>
              {auto.map((d) => <DigestDecisionRow key={d.id} decision={d} />)}
            </div>
          )}

          {unseen && (
            <div className="flex justify-end pt-1">
              <button
                onClick={() => markSeen.mutate(pass.id)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Check size={10} />
                Looks right
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The digest strip at the top of the stream tab: graduation offers plus
 *  recent pass digests, unseen first. Renders nothing when there is
 *  nothing to say — silence is the healthy state. */
export function StreamDigest() {
  const { data: passes } = useTriagePasses(10);
  const interesting = (passes ?? []).filter(
    (p) => p.status === 'completed' && (p.decisions.length > 0 || p.summary),
  );
  const unseen = interesting.filter((p) => !p.digestSeenAt);
  const shown = unseen.length > 0 ? unseen.slice(0, 3) : interesting.slice(0, 1);

  return (
    <>
      <GraduationOffers />
      {shown.length > 0 && (
        <div className="mx-4 mt-3 space-y-2">
          {shown.map((p) => (
            <PassDigest key={p.id} passId={p.id} />
          ))}
        </div>
      )}
    </>
  );
}
