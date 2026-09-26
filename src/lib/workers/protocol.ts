/**
 * The home and worker protocol's constants and messages (docs/homes-build.md,
 * "P2 protocol" and "P2.2 Enrollment and the worker connection"). Plain
 * data, shared by both sides.
 */

import { APP_SHORT_ID } from '@/constants/app';
import type {
  CreateChatEventInput,
  WorkerCommandActor,
  WorkerCommandKind,
  WorkerHarnessReport,
  WorkerReportedState,
} from '@/db/types';
import type { PendingInput } from '@/lib/runner/pending';
import type { InputFile, RunnerSignal, SessionSpec } from '@/lib/runner/types';

/**
 * An address at the home, as a session elsewhere is given it: `ri-home:` and
 * a path. The home doesn't know the address a computer reaches it by, so the
 * worker puts its own in front (P2.7).
 */
export const HOME_ADDRESS_SCHEME = 'ri-home:';

/**
 * The protocol this build speaks. A home refuses a worker on another one with
 * 426, and the worker says to update Ri there.
 *
 * 2: a session elsewhere gets its reference folders as `agentFolders`, which
 * the worker's runner resolves and wires at spawn (P2.7 to P2.9 review
 * fixes). A worker on 1 would start those sessions without them.
 */
export const WORKER_PROTOCOL = 2;
export const WORKER_PROTOCOL_HEADER = `x-${APP_SHORT_ID}-worker-protocol`;

export const WORKER_HEARTBEAT_MS = 20_000;
export const WORKER_STREAM_PING_MS = 15_000;
/** How long the home waits for a worker to answer a request. */
export const WORKER_REQUEST_TIMEOUT_MS = 15_000;

/** Reads the home can ask a worker. Never persisted. */
export type WorkerRequestKind =
  | 'describe_harnesses'
  | 'read_execution'
  | 'write_execution'
  | 'read_agent_folder'
  | 'terminal'
  | 'open_here'
  | 'review_checkout'
  | 'list_history'
  | 'read_history';

/**
 * Read an execution placed on the worker's computer. It names the execution,
 * never a path: the worker finds the worktree it prepared for it, and the
 * agent's folder from its own setup files.
 */
export interface ReadExecutionRequest {
  executionId: string;
  workspace: { id: string; isGit: boolean; baseBranch: string | null; filesToCopy: string[] };
  baseSha: string | null;
  read: import('@/lib/workspaces/execution-reads').ExecutionRead;
}

/**
 * Change an execution placed on the worker's computer (P3.5): one of the
 * defined file operations, inside the worktree it prepared. Carries the
 * placement's generation, so a computer the execution has moved away from
 * refuses it.
 */
export interface WriteExecutionRequest {
  executionId: string;
  generation: number;
  workspace: { id: string; isGit: boolean; baseBranch: string | null; filesToCopy: string[] };
  baseSha: string | null;
  write: import('@/lib/workspaces/execution-writes').ExecutionWrite;
}

/**
 * Read the folder an agent lives in on the worker's computer (P3.5): its
 * tree or one file, for the agent view. Names the agent, never a path: the
 * worker finds the folder from its own setup files.
 */
export interface ReadAgentFolderRequest {
  agentId: string;
  filesToCopy: string[];
  read: import('@/lib/workspaces/agent-folder-reads').AgentFolderRead;
}

/**
 * Open an execution's worktree or an agent's folder in an app on the
 * worker's computer (P3.5, spec §3.3), for a browser linked to that
 * computer: an editor, a terminal app or the file manager. Names the folder,
 * never a path outside it, and only known apps: never a command.
 */
export type OpenHereRequest =
  | { op: 'apps' }
  | {
      op: 'open';
      folder:
        | { kind: 'execution'; executionId: string; generation: number }
        | { kind: 'agent'; agentId: string }
        /** This computer's review checkout of an execution (P4.1). */
        | { kind: 'review'; executionId: string; workspaceSlug: string };
      /** Inside the folder, or null for the folder itself. */
      path: string | null;
      target: import('@/lib/fs/open-target').OpenTarget;
      line?: number;
      column?: number;
      reveal?: boolean;
    };

/**
 * Open code here (P4.1): a review checkout of an execution's latest
 * published commit on this computer, from its own clone of the agent's
 * repository, in a folder of its own. Refreshed only while clean.
 */
export interface ReviewCheckoutRequest {
  executionId: string;
  workspace: { id: string; slug: string };
  branch: string;
  /** The computer the work runs on, for what's said when nothing is published yet. */
  sourceName: string;
}

/** What a review checkout request found or made. */
export type ReviewCheckoutAnswer =
  | { ok: true; path: string; sha: string; created: boolean; refreshed: boolean; dirty: boolean }
  | { ok: false; code: 'not_set_up' | 'not_published' | 'failed'; message: string };

/**
 * Whose shells a terminal request addresses (P3.5, spec §5.6): an
 * execution's, in the worktree this computer prepared for the placement it
 * holds, or an agent's, in the agent's folder from this computer's own setup
 * files. Never a path the caller names.
 */
export type TerminalScope =
  | { kind: 'execution'; executionId: string; generation: number }
  | { kind: 'agent'; agentId: string };

/** A terminal operation on a worker's computer. Answered as `{ status, body }`, like the file requests. */
export type TerminalRequest =
  | { op: 'list'; scope: TerminalScope }
  | { op: 'create'; scope: TerminalScope; cols: number; rows: number }
  | { op: 'get'; scope: TerminalScope; terminalId: string }
  | { op: 'input'; scope: TerminalScope; terminalId: string; data: string }
  | { op: 'resize'; scope: TerminalScope; terminalId: string; cols: number; rows: number }
  | { op: 'close'; scope: TerminalScope; terminalId: string }
  /** What a viewer hasn't seen: the output after `since`, or all of it held. */
  | { op: 'replay'; scope: TerminalScope; terminalId: string; since?: number };

/** A terminal's output as it happens, which a worker posts to its home in batches. */
export interface TerminalOutputBatch {
  /** `offset` is the terminal's character count including this chunk, as at home. */
  chunks: Array<{ terminalId: string; data: string; offset: number }>;
  exits: Array<{ terminalId: string; code: number | null; signal: number | null }>;
}

/** A command as the stream carries it (P2 protocol, Commands). */
export interface WorkerCommand {
  /** UUIDv7, stable: the idempotency key. */
  id: string;
  /** Per computer, set when first streamed: where a stream resumes. */
  seq: number;
  kind: WorkerCommandKind;
  target: { executionId: string | null; chatSessionId: string | null; generation: number | null };
  actor: WorkerCommandActor;
  issuedAt: string;
  payload: unknown;
}

/**
 * What a `send` carries (P2 protocol, Commands): everything to start or
 * resume the session, and the text with its file markers still in, beside
 * the files they name. The worker fetches each file through the worker
 * attachment route, checks it, and puts its own path where its marker was.
 * A home disk path is never sent.
 */
export interface SendPayload {
  spec: SessionSpec;
  message: string;
  turnId: string;
  runId: string | null;
  attachments: InputFile[];
}

export type WorkerCommandAckState = 'delivered' | 'failed' | 'stale' | 'uncertain';

export interface WorkerCommandAckBody {
  state: WorkerCommandAckState;
  result?: unknown;
  error?: string | null;
}

/**
 * A chat event as a worker journals it. The envelope names the chat; the row
 * never does. It names no files: a computer's files reach home only through
 * the artifact upload, which comes with the first output Ri keeps
 * (docs/homes-build.md, P2.5).
 */
export type WorkerChatEvent = Omit<CreateChatEventInput, 'sessionId' | 'id' | 'attachments'>;

/** One entry of a worker's event journal (P2 protocol, Events). */
export type WorkerEvent = {
  /** Contiguous from 1 in this computer's journal. */
  position: number;
  /** UUIDv7 minted when the worker parsed it; a chat event's id. */
  eventId: string;
  /** The placement generation that ran it, stamped on the worker. Required for a chat with an execution. */
  generation: number | null;
  chatSessionId: string;
  occurredAt: string;
  /** For a chat event: the run of the turn it came from, which its cost is charged to. */
  runId?: string | null;
} & (
  | { kind: 'chat_event'; chatEvent: WorkerChatEvent; cumulative: boolean }
  | { kind: 'signal'; signal: RunnerSignal }
);

export type WorkerStreamEvent =
  | { type: 'hello'; homeId: string; computerId: string; protocol: number; ackedEventSeq: number }
  | { type: 'command'; command: WorkerCommand }
  | { type: 'request'; id: string; kind: WorkerRequestKind; payload: unknown }
  | { type: 'revoked'; message: string }
  | { type: 'ping' };

/** What's live on the worker's computer, for the home's mirror. */
export interface WorkerLive {
  running: string[];
  pending: PendingInput[];
  backgroundTasks: Record<string, string[]>;
  /** The placement generation of each chat named above, which the home checks is still this computer's. */
  generations?: Record<string, number | null>;
}

export interface WorkerPlacementReport {
  executionId: string;
  generation: number;
  chatSessionIds: string[];
}

export interface WorkerHeartbeat {
  protocol: number;
  version: string;
  harnesses: WorkerHarnessReport[];
  state: WorkerReportedState;
  /** Live state and held placements. Absent from a worker that runs nothing yet. */
  live?: WorkerLive;
  placements?: WorkerPlacementReport[];
}

/** The home's answer to a heartbeat: placements this computer no longer holds, whose sessions it stops. */
export interface WorkerHeartbeatReply {
  ok: true;
  /** Placements this computer reported that the home no longer gives it, each through the generation reported. */
  release: Array<{ executionId: string; generation: number; chatSessionIds: string[] }>;
}

export type WorkerRequestResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; unsupported?: boolean };

/** What a home says to a worker on another protocol. */
export function protocolMismatchMessage(computerName: string): string {
  return `Update Ri on ${computerName}. It speaks a different version of the home and worker protocol than this home.`;
}
