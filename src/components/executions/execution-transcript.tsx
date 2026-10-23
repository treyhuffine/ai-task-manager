'use client';

import type { WorkspaceRecord } from '@/db/types';
import type { ChatSessionWithExecution } from '@/lib/api/dto/records';
import { useClientEventStatus, useLoadOlderEvents, useSessionEvents } from '@/hooks/use-execution';
import { ChatTranscript } from '@/components/chat-ui/chat-transcript';
import { SetupCard } from './setup-card';
import { ChatAudience, useMemberMessageHeader } from '@/components/chat-ui/member-attribution';

interface ExecutionTranscriptProps {
  session: ChatSessionWithExecution;
  workspace: WorkspaceRecord | undefined;
  isRunning: boolean;
  /** Event ids that this client sent via voice — drives the badge under user messages. */
  voiceSentIds?: ReadonlySet<string>;
  /**
   * Classes for the element that scrolls. Padding here keeps content clear
   * of something floating over the transcript (the tools box) while the
   * scrollbar stays at the column's far right edge.
   */
  scrollClassName?: string;
}


/** The owning Home supplies authors and audience around the common transcript. */
export function ExecutionTranscript({ session, workspace, isRunning, voiceSentIds, scrollClassName }: ExecutionTranscriptProps) {
  const { data: events, isLoading } = useSessionEvents(session.id);
  const eventHeader = useMemberMessageHeader(events, session.id);
  const clientStatus = useClientEventStatus(session.id);
  const { loadOlder, isLoadingOlder, hasOlder } = useLoadOlderEvents(session.id, events);
  return <><ChatAudience createdByMemberId={session.createdByMemberId}/><ChatTranscript session={session} events={events} isLoading={isLoading} clientStatus={clientStatus} loadOlder={loadOlder} isLoadingOlder={isLoadingOlder} hasOlder={hasOlder} isRunning={isRunning} voiceSentIds={voiceSentIds} scrollClassName={scrollClassName} eventHeader={eventHeader} before={<SetupCard session={session} workspace={workspace} />} /></>;
}
