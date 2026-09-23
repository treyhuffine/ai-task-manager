'use client';

import { CornerDownRight } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useSession } from '@/hooks/use-execution';
import { useWorkspace } from '@/hooks/use-workspaces';

/**
 * Who sent a message that another chat sent (docs/agents-view-spec.md Phase
 * 7, "Provenance in transcripts"). Messages carry `senderSessionId` when an
 * agent's main chat or the app's main chat sent them with
 * `send_session_message` or `start_execution`. The chip names the sender
 * and opens it. Messages the user typed have no chip.
 */
export function SenderChip({ senderSessionId }: { senderSessionId: string }) {
  const { openAgent, openExecution, goHome } = useDashboard();
  const { data: sender, isError } = useSession(senderSessionId);
  const agentId = sender?.type === 'orchestration' ? sender.workspaceId ?? null : null;
  const { data: agent } = useWorkspace(agentId);

  let label: string;
  let open: (() => void) | null = null;
  if (isError) {
    label = 'From a chat that was deleted';
  } else if (!sender) {
    label = 'From another chat';
  } else if (sender.type === 'orchestration' && agentId) {
    label = `From ${agent?.name ?? 'an agent'}`;
    open = () => openAgent(agentId);
  } else if (sender.type === 'orchestration') {
    label = 'From orchestrator';
    open = goHome;
  } else if (sender.type === 'execution') {
    label = `From ${sender.execution?.label ?? sender.label ?? 'another execution'}`;
    open = () => openExecution(sender.id);
  } else {
    label = 'From a document chat';
  }

  const className =
    'self-end mb-0.5 inline-flex max-w-[18rem] items-center gap-1 rounded-full px-1.5 py-px text-[10.5px] text-muted-foreground';
  const content = (
    <>
      <CornerDownRight size={10} className="flex-shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </>
  );
  return open ? (
    <button onClick={open} className={`${className} hover:text-foreground hover:bg-muted/60 transition-colors`} title={`Open: ${label.replace(/^From /, '')}`}>
      {content}
    </button>
  ) : (
    <span className={className}>{content}</span>
  );
}
