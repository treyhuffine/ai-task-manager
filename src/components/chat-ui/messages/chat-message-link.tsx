'use client';

import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, MessageSquare } from 'lucide-react';
import { useOptionalDashboard } from '@/contexts/dashboard-context';
import { useSession } from '@/hooks/use-execution';
import { useWorkspace } from '@/hooks/use-workspaces';
import { useOrchestratorName } from '@/hooks/use-user-state';
import { executionView, viewHref } from '@/lib/client/active-view';
import { apiErrorStatus } from '@/lib/api/error-status';
import { Tip } from '@/components/ui/tip';
import { cn } from '@/lib/utils';

/** A visible conversation relationship, with native link behavior and dashboard navigation. */
export function ChatMessageLink({ sessionId, label, direction, preview, header = false }: {
  sessionId: string;
  label: string;
  direction: 'incoming' | 'outgoing';
  preview?: string;
  header?: boolean;
}) {
  const dashboard = useOptionalDashboard();
  const { data: session, error } = useSession(sessionId);
  const { data: agent } = useWorkspace(session?.workspaceId ?? null);
  const orchestratorName = useOrchestratorName();
  const unavailable = apiErrorStatus(error) === 404;
  const title = unavailable ? 'Deleted chat'
    : session?.type === 'orchestration' ? session.label ?? agent?.name ?? (session.workspaceId ? 'Agent main chat' : orchestratorName)
    : session?.execution?.label ?? session?.label ?? (session ? 'Untitled chat' : error ? 'Chat temporarily unavailable' : 'Loading chat…');
  const context = session?.type === 'orchestration' ? (session.workspaceId ? 'Agent main chat' : 'Main chat') : agent?.name;
  const view = executionView(sessionId);
  const className = cn(
    'group/chat-link flex min-w-0 items-start gap-2.5 px-3 py-2.5 text-left transition-colors',
    header ? 'rounded-t-xl' : 'rounded-lg border border-border bg-muted/15',
    !unavailable && 'cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  );
  const content = <>
    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" aria-hidden>
      {direction === 'incoming' ? <ArrowDownLeft size={15} /> : <MessageSquare size={14} />}
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
        <span className="shrink-0">{label}</span>
        {context && <><span aria-hidden>·</span><span className="truncate">{context}</span></>}
      </span>
      <span className={cn('mt-0.5 block break-words text-[12.5px] font-medium leading-5 text-foreground', !unavailable && 'underline decoration-foreground/25 underline-offset-3 group-hover/chat-link:decoration-foreground/70')}>
        {title}
      </span>
      {preview && <span className="mt-1 line-clamp-2 break-words text-[12px] leading-5 text-muted-foreground">{preview}</span>}
    </span>
    {!unavailable && <ArrowUpRight size={15} className="mt-3 shrink-0 text-muted-foreground group-hover/chat-link:text-foreground" aria-hidden />}
  </>;
  if (unavailable) return <div className={className}>{content}</div>;
  return <Tip label="Open the linked chat">
    <Link href={viewHref(view)} prefetch={false} className={className} aria-label={`${label} ${title}. Open chat`}
      onClick={event => {
        if (!dashboard || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        dashboard.setActiveView(view);
      }}>{content}</Link>
  </Tip>;
}
