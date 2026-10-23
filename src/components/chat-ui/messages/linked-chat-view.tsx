'use client';

import { HomeLink } from '@/components/home/home-link';
import { useOptionalWorkNavigation } from '@/contexts/work-context';
import { HarnessChatSession } from '@/components/chat/harness-chat';
import { ExecutionTranscript } from '@/components/executions/execution-transcript';
import { useWorkspace } from '@/hooks/use-workspaces';
import { useOrchestratorName } from '@/hooks/use-user-state';
import { useSessionStream } from '@/hooks/use-session-stream';
import { agentView, executionView, HOME_VIEW, viewHref } from '@/lib/client/active-view';
import type { ChatSessionWithExecution } from '@/lib/api/dto/records';

/** Exact non-execution chat navigation never replaces or resumes a scope's current main chat. */
export function LinkedChatView({ session }: { session: ChatSessionWithExecution }) {
  const navigation = useOptionalWorkNavigation();
  const { data: workspace } = useWorkspace(session.workspaceId ?? null);
  const orchestratorName = useOrchestratorName();
  const archived = session.status === 'archived';
  useSessionStream(archived ? session.id : null);
  const currentView = session.workspaceId ? agentView(session.workspaceId) : HOME_VIEW;
  const title = session.label ?? workspace?.name ?? orchestratorName;
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Linked chat">
    <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0 flex-1">
        <h1 className="break-words text-sm font-medium">{title}</h1>
        {archived && <p className="mt-1 text-xs text-muted-foreground">Archived chat</p>}
      </div>
      <HomeLink href={viewHref(session.executionId ? executionView(session.id) : currentView)} className="shrink-0 text-xs underline underline-offset-4" onClick={event => {
        if (!navigation || !session.executionId && !navigation.openCurrentChat) return;
        event.preventDefault();
        if (session.executionId) navigation.openExecution(session.id);
        else navigation.openCurrentChat?.(session.workspaceId ?? null);
      }}>{session.executionId ? 'Continue this chat' : 'Open current chat'}</HomeLink>
    </header>
    {archived
      ? <ExecutionTranscript session={session} workspace={workspace} isRunning={false} />
      : <HarnessChatSession sessionId={session.id} autoFocusComposer={false} />}
  </section>;
}
