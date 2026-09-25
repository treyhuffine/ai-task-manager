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
import type { CreateChatEventInput, EffortLevel, PermissionMode, WorkerCommandActor } from '@/db/types';
import type { HarnessId } from '@/lib/harness/registry';
import type { PendingInput } from './pending';

/** Everything a runner needs to start or resume one chat's harness session. Plain JSON. */
export interface SessionSpec {
  chatSessionId: string;
  harness: HarnessId;
  /** The folder the harness runs in, on the runner's computer. */
  cwd: string;
  /**
   * Set instead of `cwd` when the execution is still being prepared on the
   * runner's computer: run in the worktree it prepares for this execution.
   * The worker carries out an execution's commands in order, so the prepare
   * finishes before this send starts.
   */
  preparedWorktreeOf?: string | null;
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
  /** Required when the runner has no live session for the chat. A remote runner always gets one. */
  spec: SessionSpec | null;
  /** The user's chat event this sends, so one message is sent once however many paths try. */
  sourceEventId?: string | null;
  /** Who is sending, from the caller's credentials. */
  actor?: WorkerCommandActor;
  /**
   * For a chat on a connected computer: the files the message's markers
   * name, which its worker fetches and places (P2.5). The home's own runner
   * gets their paths in the message instead.
   */
  files?: InputFile[];
}

/** A file sent with a message to a computer elsewhere, as the home has it. */
export interface InputFile {
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  /** Hex sha256 of the bytes, which the receiving computer checks. */
  sha256: string;
}

export type SendResult =
  /** The harness accepted the message. The turn's end arrives as `turn_result`. */
  | { status: 'delivered' }
  /**
   * Saved at home as a command for the computer that runs the chat. Its
   * worker delivers it when it has it, and the turn's end arrives as
   * `turn_result` like any other.
   */
  | { status: 'queued'; commandId: string }
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
  /** Sent as a command to the computer that runs the chat, which stops it when it receives it. */
  queued?: boolean;
}

/** `refused` says why the answer wasn't given. Without it, the prompt is no longer waiting. */
export type AnswerResult = { ok: true; pending: PendingInput } | { ok: false; refused?: string };

/**
 * Each call names who is acting, from their credentials (P2.6). A connected
 * computer's command carries it. Absent means the system itself.
 */
export interface ExecutionRunner {
  send(req: SendRequest): Promise<SendResult>;
  interrupt(chatSessionId: string, actor?: WorkerCommandActor): Promise<void>;
  stopTask(chatSessionId: string, taskId: string, actor?: WorkerCommandActor): Promise<{ stopped: boolean; queued?: boolean }>;
  /** Close the harness and clear its live state. */
  stop(chatSessionId: string, actor?: WorkerCommandActor): Promise<StopReport>;
  /** Refused for an agent approving a permission (`answerRefusal`). */
  answerPendingInput(
    chatSessionId: string,
    requestId: string,
    response: UserInputResponse,
    actor: WorkerCommandActor,
  ): AnswerResult;
}
