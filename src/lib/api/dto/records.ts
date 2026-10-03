import type { ChatEventRecord as Event, ChatSessionWithExecution as ExecutionSession, ChatSessionRecord as Session } from '@/db/types';
import type { Serialize } from '@trpc/server/unstable-core-do-not-import';
/** JSON may omit undefined provider payloads. Rail projections also omit
 * large scratchpad and transcript-path fields that detail reads retain. */
export type ChatSessionRecord = Serialize<Session>;
export type ChatSessionWithExecution = Omit<Serialize<ExecutionSession>, 'scratchPad' | 'externalTranscriptPath'> & Partial<Pick<Serialize<ExecutionSession>, 'scratchPad' | 'externalTranscriptPath'>>;
export type ChatEventRecord = Serialize<Event>;
