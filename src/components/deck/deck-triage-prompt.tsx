"use client";

/**
 * The deck's compact stream prompt (spec §3.12): one calm line when triage
 * left something for the user, plus the latest unseen digest headline. It
 * never blocks the deck and renders nothing when nothing needs the user —
 * silence is the healthy state. The deck must not become a second copy of
 * Recent Captures, so this is a pointer, not a list.
 */

import { Inbox, Sparkles } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useProposedDecisions, useTriagePasses, useMarkPassSeen } from '@/hooks/use-stream';

export function DeckTriagePrompt() {
  const { setPanelTab, focusedPanel } = useDashboard();
  const { data: proposals } = useProposedDecisions();
  const { data: passes } = useTriagePasses(3);
  const markSeen = useMarkPassSeen();

  const proposalCount = proposals?.length ?? 0;
  const latestUnseen = (passes ?? []).find(
    (p) => p.status === 'completed' && !p.digestSeenAt && (p.decisions.length > 0 || p.summary),
  );

  if (proposalCount === 0 && !latestUnseen) return null;

  const openStream = () => setPanelTab(focusedPanel, 'stream');

  return (
    <div className="mb-3 space-y-1.5">
      {proposalCount > 0 && (
        <button
          onClick={openStream}
          className="w-full flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-left hover:bg-primary/10 transition-colors"
        >
          <Inbox size={12} className="text-primary shrink-0" />
          <span className="text-[11px] text-foreground">
            {proposalCount === 1 ? 'One thought needs your call' : `${proposalCount} thoughts need your call`}
          </span>
        </button>
      )}
      {latestUnseen && proposalCount === 0 && (
        <button
          onClick={() => {
            markSeen.mutate(latestUnseen.id);
            openStream();
          }}
          className="w-full flex items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-2 text-left hover:bg-muted transition-colors"
        >
          <Sparkles size={12} className="text-muted-foreground shrink-0" />
          <span className="text-[11px] text-muted-foreground truncate">
            {latestUnseen.summary ?? 'Your captures were triaged while you were away.'}
          </span>
        </button>
      )}
    </div>
  );
}
