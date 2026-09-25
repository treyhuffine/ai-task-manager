/**
 * The runner boundary (docs/homes-build.md, "P2.1 The runner split").
 *
 * A runner turns a session spec into a running harness on its computer and
 * reports everything it learns through a sink. It never reads the database:
 * the home decides what a session needs and sends it as a `SessionSpec`,
 * and applies what comes back. The home's own computer runs the local runner
 * in process. A connected computer runs the same code in its worker.
 *
 * Type-only imports from the database schema are fine here. They describe
 * shapes and are erased at runtime.
 */

import type { McpServerConfig, RuntimeCommandInventory, UserInputResponse } from '@agentex/agent';
import type { CreateChatEventInput, EffortLevel, PermissionMode } from '@/db/types';
import type { HarnessId } from '@/lib/harness/registry';
import type { PendingInput } from './pending';

/** Everything a runner needs to start or resume one chat's harness session. Plain JSON. */
export interface SessionSpec {
  chatSessionId: string;
  harness: HarnessId;
  /** The folder the harness runs in, on the runner's computer. */
  cwd: string;
  sessionType: 'orchestration' | 'content' | 'execution';
  /** The harness's own session id to resume, when the chat has one. */
  nativeSessionId: string | null;
  permissionMode: PermissionMode;
  /** The mode to return to when the agent leaves plan mode itself. */
  prePlanMode: PermissionMode | null;
  model: string | null;
  modelVariant: string | null;
  effort: EffortLevel | null;
  /** Provider config the home decided: servers, tool filters and flags. */
  mcpServers: McpServerConfig[];
  strictMcpConfig: boolean;
  disallowedTools: string[];
  /** Harness arguments, after the ones the permission mode adds. */
  extraArgs: string[];
  /** Session instructions, already planned for this harness. The runner writes them where the harness reads them. */
  instructions: string | null;
  /** A brief to put before the first message of a fresh session, for harnesses that drop session instructions. */
  firstTurnPreamble: string | null;
  /** Extra environment for the harness, such as the session's caller credential. */
  env: Record<string, string>;
  /** Whether the user's skill folders are attached. */
  attachUserSkills: boolean;
  /** Remove skill links a past build left in the working folder. */
  cleanLegacySkillLinks: boolean;
}

export interface SendRequest {
  chatSessionId: string;
  /** The text as the harness should receive it, labels already applied. */
  message: string;
  /** Names this turn in `turn_result`. */
  turnId: string;
  runId: string | null;
  /** Required when the runner has no live session for the chat. */
  spec: SessionSpec | null;
}

export type SendResult =
  /** The harness accepted the message. The turn's end arrives as `turn_result`. */
  | { status: 'delivered' }
  /** No live session, and no spec to start one: send again with a spec. */
  | { status: 'needs_spec' };

export type RunnerSignal =
  | { type: 'running'; running: boolean }
  | { type: 'background_tasks'; active: boolean; taskIds: string[] }
  | { type: 'inventory'; inventory: RuntimeCommandInventory }
  | { type: 'native_session'; nativeSessionId: string }
  | { type: 'pending_input'; pending: PendingInput }
  | { type: 'pending_resolved'; pending: PendingInput; response: UserInputResponse }
  | { type: 'pending_changed'; pending: PendingInput[] }
  | { type: 'turn_result'; turnId: string; runId: string | null; ok: boolean; error: string | null };

/** Where chat events go: inserted, or replacing a cumulative provider part. */
export interface EventWriter {
  /** Resolves true when the event was new: inserted at home, or journaled on a worker. */
  write(event: CreateChatEventInput): Promise<boolean>;
  /** Replace one cumulative provider part when the same stable part id advances. */
  replacePart?(event: CreateChatEventInput): Promise<void>;
}

/** Everything a runner reports. The home's sink writes the database; a worker's journals and posts. */
export interface RunnerSink {
  writer: EventWriter;
  signal(chatSessionId: string, signal: RunnerSignal): void;
}

export interface StopReport {
  closed: boolean;
  error?: string;
}

export type AnswerResult = { ok: true; pending: PendingInput } | { ok: false };

export interface ExecutionRunner {
  send(req: SendRequest): Promise<SendResult>;
  interrupt(chatSessionId: string): Promise<void>;
  stopTask(chatSessionId: string, taskId: string): Promise<{ stopped: boolean }>;
  /** Close the harness and clear its live state. */
  stop(chatSessionId: string): Promise<StopReport>;
  answerPendingInput(chatSessionId: string, requestId: string, response: UserInputResponse): AnswerResult;
}
