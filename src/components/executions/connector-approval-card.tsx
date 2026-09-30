'use client';

import { useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Check, ChevronRight, Clock, Loader2, RotateCcw, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { ConnectorLogo } from '@/components/connectors/connector-logo';
import { useSessionEvents } from '@/hooks/use-execution';
import { useLiveConnectorApprovals, useResolveConnectorApprovals } from '@/hooks/use-connector-approvals';
import { apiErrorText } from '@/lib/api/client';
import { sessionsApi } from '@/lib/api/sessions';
import type { ConnectorApprovalDecision } from '@/lib/api/connector-approvals';
import type { ApprovalOutcome, ApprovalRequestView } from '@/lib/connectors/approval-describe';
import {
  approvalDecisions,
  approvalItemState,
  approvalRequestView,
  countStates,
  type ApprovalItemState,
} from '@/lib/executions/connector-approvals';
import { cn } from '@/lib/utils';
import type { ChatEventRecord } from '@/db/types';

/** Items shown before "Show N more" on a large batch. */
const VISIBLE_ITEMS = 5;

interface ConnectorApprovalCardProps {
  /** The card's `approval_request` rows, leader first (see coalesceApprovalRequests). */
  rows: readonly ChatEventRecord[];
  sessionId?: string;
  /**
   * The card sits after the user's latest message. Only then does an expired card offer to ask
   * the agent to try again. An older one is history the conversation has moved past.
   */
  isLatest: boolean;
}

/**
 * Inline approval for connector actions paused on "Ask first". One card per burst of the same
 * action on the same account, so eight parallel calendar deletes read as one "Delete event × 8"
 * with one set of buttons. Each item names what that call touches, and each can also be answered
 * on its own.
 *
 * Buttons show only for requests the server still holds (the live set the session stream
 * pushes). Once answered, the card shows the recorded decision, which survives reloads and
 * restarts. A request that vanished undecided (the app restarted, say) reads as expired.
 */
export function ConnectorApprovalCard({ rows, sessionId, isLatest }: ConnectorApprovalCardProps) {
  const views = useMemo(
    () => rows.map(approvalRequestView).filter((v): v is ApprovalRequestView => v !== null),
    [rows],
  );
  const { data: events } = useSessionEvents(sessionId ?? null);
  const decisions = useMemo(() => approvalDecisions(events ?? []), [events]);
  const { data: liveIds } = useLiveConnectorApprovals(sessionId ?? null);
  const live = useMemo(() => (liveIds ? new Set(liveIds) : undefined), [liveIds]);
  const resolve = useResolveConnectorApprovals(sessionId ?? '');
  // Decisions the server just accepted from this tab, shown until the recorded rows arrive over the
  // stream. Set on success, not on click: a failed request must never read as approved.
  const [sent, setSent] = useState<ReadonlyMap<string, ApprovalOutcome>>(new Map());
  const [showAll, setShowAll] = useState(false);

  // A recorded decision always wins. Until it arrives, one this tab just made covers the gap.
  const states = views.map((v) => {
    const state = approvalItemState(v.approvalId, decisions, live);
    return decisions.has(v.approvalId) ? state : (sent.get(v.approvalId) ?? state);
  });
  const head = views[0];
  if (!head) return null;

  const pendingIds = views.filter((_, i) => states[i] === 'pending').map((v) => v.approvalId);
  const isPending = pendingIds.length > 0;
  const multi = views.length > 1;

  const act = (decision: ConnectorApprovalDecision, ids: string[]) => {
    if (!sessionId || ids.length === 0) return;
    resolve.mutate(
      { ids, decision },
      {
        onSuccess: (data) =>
          setSent((prev) => new Map([...prev, ...data.resolved.map((id) => [id, decision] as const)])),
        onError: (err) => toast.error(apiErrorText(err)),
      },
    );
  };
  const busy = resolve.isPending;
  const busyDecision = busy ? resolve.variables?.decision : undefined;

  const visible = showAll ? views : views.slice(0, VISIBLE_ITEMS);
  const hidden = views.length - visible.length;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-card text-[11px]',
        isPending ? 'border-amber-500/40' : 'border-border',
      )}
    >
      {/* Two lines, so the account the call acts as stays readable in a narrow panel. */}
      <div
        className={cn(
          'flex items-center gap-2.5 border-b px-3 py-2',
          isPending ? 'border-amber-500/20 bg-amber-500/5' : 'border-border/60 bg-muted/20',
        )}
      >
        <ConnectorLogo providerId={head.providerId} name={head.toolkitName} size={24} className="rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-foreground">
              {head.actionLabel}
              {multi && <span className="font-normal text-muted-foreground"> × {views.length}</span>}
            </span>
            {head.outward && <RiskChip>Visible to others</RiskChip>}
            {head.risk === 'high' && <RiskChip>Can’t be undone</RiskChip>}
          </div>
          <div className="truncate text-[10.5px] text-muted-foreground">
            {head.toolkitName}
            {head.account && ` · ${head.account}`}
          </div>
        </div>
      </div>

      <ul className="divide-y divide-border/40">
        {visible.map((view, i) => (
          <ApprovalItem
            key={view.approvalId}
            view={view}
            state={states[i]!}
            // One-off answers only make sense inside a batch. A single request uses the footer.
            onDecide={multi ? (decision) => act(decision, [view.approvalId]) : undefined}
            disabled={busy}
          />
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full border-t border-border/40 px-3 py-1.5 text-left text-[10.5px] text-muted-foreground hover:bg-muted/30"
        >
          Show {hidden} more
        </button>
      )}

      {isPending ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/20 px-3 py-2">
          <FooterButton
            tone="deny"
            disabled={busy}
            busy={busyDecision === 'deny'}
            onClick={() => act('deny', pendingIds)}
          >
            {pendingIds.length > 1 ? `Deny all ${pendingIds.length}` : 'Deny'}
          </FooterButton>
          <div className="flex-1" />
          <FooterButton
            tone="secondary"
            disabled={busy}
            busy={busyDecision === 'always'}
            onClick={() => act('always', pendingIds)}
            title={`Stop asking before ${head.actionLabel.toLowerCase()} runs on ${head.toolkitName}. Turn Ask first back on in Settings, Plugins.`}
          >
            Always allow
          </FooterButton>
          <FooterButton
            tone="primary"
            disabled={busy}
            busy={busyDecision === 'approve'}
            onClick={() => act('approve', pendingIds)}
          >
            {pendingIds.length > 1 ? `Approve all ${pendingIds.length}` : 'Approve once'}
          </FooterButton>
        </div>
      ) : (
        <CardStatus states={states} actionLabel={head.actionLabel} toolName={head.toolName} sessionId={sessionId} isLatest={isLatest} />
      )}
    </div>
  );
}

function RiskChip({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[9.5px] font-medium text-amber-600 dark:text-amber-400">
      {children}
    </span>
  );
}

function ApprovalItem({
  view,
  state,
  onDecide,
  disabled,
}: {
  view: ApprovalRequestView;
  state: ApprovalItemState;
  onDecide?: (decision: ConnectorApprovalDecision) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = view.details.length > 0;
  return (
    <li className="px-3 py-1.5">
      <div className="flex items-center gap-2">
        <ItemStateIcon state={state} />
        <button
          type="button"
          onClick={() => hasDetails && setExpanded((v) => !v)}
          className={cn('flex min-w-0 flex-1 items-center gap-1 text-left', !hasDetails && 'cursor-default')}
          aria-expanded={hasDetails ? expanded : undefined}
        >
          <span className={cn('truncate', state === 'expired' ? 'text-muted-foreground' : 'text-foreground/90')}>
            {view.summary}
          </span>
          {hasDetails && (
            <ChevronRight
              size={10}
              className={cn('shrink-0 text-muted-foreground/50 transition-transform', expanded && 'rotate-90')}
            />
          )}
        </button>
        {onDecide && state === 'pending' && (
          <span className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onDecide('approve')}
              title="Approve this one"
              aria-label={`Approve ${view.summary}`}
              className="rounded p-1 text-muted-foreground/70 hover:bg-emerald-500/10 hover:text-emerald-600 disabled:opacity-50"
            >
              <Check size={11} />
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onDecide('deny')}
              title="Deny this one"
              aria-label={`Deny ${view.summary}`}
              className="rounded p-1 text-muted-foreground/70 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            >
              <X size={11} />
            </button>
          </span>
        )}
      </div>
      {expanded && (
        <dl className="ml-5 mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10.5px]">
          {view.details.map((d) => (
            <div key={d.label} className="contents">
              <dt className="text-muted-foreground/70">{d.label}</dt>
              <dd className="min-w-0 break-words font-mono text-muted-foreground">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

function ItemStateIcon({ state }: { state: ApprovalItemState }) {
  switch (state) {
    case 'approve':
    case 'always':
    case 'settled':
      return <Check size={11} className="shrink-0 text-emerald-500" aria-label="Approved" />;
    case 'deny':
      return <X size={11} className="shrink-0 text-destructive" aria-label="Denied" />;
    case 'expired':
      return <Clock size={11} className="shrink-0 text-muted-foreground/60" aria-label="Expired" />;
    case 'loading':
      return <Loader2 size={11} className="shrink-0 animate-spin text-muted-foreground/50" aria-label="Loading" />;
    case 'pending':
      return <ShieldAlert size={11} className="shrink-0 text-amber-500" aria-label="Waiting for approval" />;
  }
}

function FooterButton({
  tone,
  busy,
  children,
  ...props
}: {
  tone: 'primary' | 'secondary' | 'deny';
  busy: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'primary' && 'bg-primary text-primary-foreground hover:opacity-90',
        tone === 'secondary' && 'border border-border bg-background text-foreground hover:bg-muted/60',
        tone === 'deny' && 'border border-destructive/40 text-destructive hover:bg-destructive/10',
      )}
    >
      {busy && <Loader2 size={11} className="animate-spin" />}
      {children}
    </button>
  );
}

/** The footer once nothing is left to answer: what happened, in one line. */
function CardStatus({
  states,
  actionLabel,
  toolName,
  sessionId,
  isLatest,
}: {
  states: readonly ApprovalItemState[];
  actionLabel: string;
  toolName: string;
  sessionId?: string;
  isLatest: boolean;
}) {
  const counts = countStates(states);
  const n = states.length;
  const only = (s: ApprovalItemState) => counts[s] === n;
  const retry = useMutation({
    mutationFn: () =>
      sessionsApi.sendMessage(
        sessionId!,
        `Please retry the ${toolName} ${n === 1 ? 'call that was' : 'calls that were'} waiting for my approval.`,
      ),
    onError: (err) => toast.error(apiErrorText(err)),
  });

  if (counts.loading) {
    return (
      <div className="flex items-center gap-1.5 border-t border-border/60 px-3 py-1.5 text-muted-foreground">
        <Loader2 size={11} className="animate-spin" />
        <span>Checking…</span>
      </div>
    );
  }

  let icon = <ShieldCheck size={11} className="text-emerald-500" />;
  let text: string;
  if (only('approve')) text = n > 1 ? `Approved ${n}. The agent was told to retry them.` : 'Approved once. The agent was told to retry it.';
  else if (only('always')) text = `Always allowed. Ask first is off for ${actionLabel.toLowerCase()}, turn it back on in Settings, Plugins.`;
  else if (only('settled')) text = 'Ran under your current connector settings.';
  else if (only('deny')) {
    icon = <X size={11} className="text-destructive" />;
    text = n > 1 ? `Denied ${n}. The agent was told not to retry them.` : 'Denied. The agent was told not to retry it.';
  } else if (only('expired')) {
    icon = <Clock size={11} className="text-muted-foreground/70" />;
    text = n > 1 ? 'These requests expired before you answered.' : 'This request expired before you answered.';
  } else {
    const parts = [
      counts.approve && `${counts.approve} approved`,
      counts.always && `${counts.always} always allowed`,
      counts.settled && `${counts.settled} ran`,
      counts.deny && `${counts.deny} denied`,
      counts.expired && `${counts.expired} expired`,
    ].filter(Boolean);
    text = parts.join(' · ');
  }

  const canRetry = only('expired') && isLatest && !!sessionId;
  return (
    <div className="flex items-center gap-1.5 border-t border-border/60 px-3 py-1.5 text-muted-foreground">
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">{text}</span>
      {canRetry && (
        <button
          type="button"
          disabled={retry.isPending || retry.isSuccess}
          onClick={() => retry.mutate()}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[10.5px] font-medium text-foreground hover:bg-muted/60 disabled:opacity-50"
        >
          {retry.isPending ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
          {retry.isSuccess ? 'Asked' : 'Ask the agent to retry'}
        </button>
      )}
    </div>
  );
}
