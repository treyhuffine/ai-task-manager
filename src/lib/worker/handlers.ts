/**
 * How this computer's worker carries out execution commands
 * (docs/homes-build.md, P2 protocol and P2.4): send, interrupt, stop a task,
 * stop, and answer a prompt, each through the local runner, with the
 * placement fence and the recovery rule from "Command receipt and recovery".
 *
 * Fencing: every execution command carries the placement generation the home
 * had when it queued it. A generation older than the newest this computer
 * has seen for that execution is `stale`, and nothing happens.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import type { UserInputResponse } from '@agentex/agent';
import type { WorkspaceRecord } from '@/db/types';
import { readSetupFile } from '@/lib/setups/local-file';
import { listRegisteredLocations } from '@/lib/setups/registry';
import { copyFilesToWorktree } from '@/lib/workspaces/files-to-copy';
import { createWorktreeForSession, fetchPrHead, runWorktreeScript } from '@/lib/workspaces/index';
import { getClaudeTranscriptPath } from '@agentex/agent';
import { harnessDefinition } from '@/lib/harness/registry';
import { ExecutorError } from '@/lib/runner/errors';
import * as runner from '@/lib/runner/local-runner';
import type { SessionSpec } from '@/lib/runner/types';
import type { ReadExecutionRequest, SendPayload, WorkerCommand, WorkerCommandAckBody } from '@/lib/workers/protocol';
import { readExecution } from '@/lib/workspaces/execution-reads';
import type { CommandJournal } from './command-journal';
import type { CommandContext, CommandHandlers, CommandKindHandler } from './commands';
import { fetchInputFiles, inputFilesDir, placeInputFiles } from './input-files';
import { UnsupportedRequestError, type RequestHandler } from './run';

const run = promisify(execFile);

/** What the home sends to prepare an execution here: its agent, as the home knows it, and how to start it. */
export interface PreparePayload {
  workspace: WorkspaceRecord;
  chatSessionId: string;
  label: string | null;
  baseBranch: string | null;
  prNumber: number | null;
  /** Work in the agent's folder itself, on whatever it has checked out. */
  live: boolean;
}

export interface PrepareResult {
  worktreePath: string;
  branchName: string | null;
  baseSha: string | null;
  warning: string | null;
}

export interface SetupScriptPayload {
  script: 'setup';
  workspaceId: string;
  command: string;
  worktreePath: string;
  branchName: string | null;
}

/** The folder this computer set up for an agent, from its own setup files. */
export function agentFolderHere(homeId: string, agentId: string): string | null {
  for (const { dir } of listRegisteredLocations()) {
    const read = readSetupFile(dir);
    if (read.state === 'ok' && read.file.homeId === homeId && read.file.agents[agentId]) return dir;
  }
  return null;
}

async function gitOut(cwd: string, args: string[]): Promise<string | null> {
  try {
    return (await run('git', args, { cwd })).stdout.trim() || null;
  } catch {
    return null;
  }
}

function tail(text: string, lines = 40): string {
  return text.split('\n').slice(-lines).join('\n');
}

export interface ExecutionHandlerOptions {
  journal: CommandJournal;
  /** Whether the chat's native history holds this message. Defaults to reading Claude's transcript. */
  findInHistory?: (spec: SessionSpec, message: string) => Promise<'found' | 'missing' | 'unknown'>;
}

function stale(command: WorkerCommand): WorkerCommandAckBody {
  return { state: 'stale', error: `This command was for an earlier placement (generation ${command.target.generation}).` };
}

/** Whether a newer placement of this execution has already reached this computer. */
function fenced(journal: CommandJournal, command: WorkerCommand): boolean {
  const { executionId, generation } = command.target;
  if (!executionId || generation === null) return false;
  const newest = journal.highestGeneration(executionId);
  return newest !== null && generation < newest;
}

function chatOf(command: WorkerCommand): string {
  const chat = command.target.chatSessionId;
  if (!chat) throw new Error(`A ${command.kind} command needs a chat.`);
  return chat;
}

function failure(err: unknown): WorkerCommandAckBody {
  return { state: 'failed', error: err instanceof ExecutorError || err instanceof Error ? err.message : String(err) };
}

/**
 * Look for a sent message in Claude's transcript for the session: a user line
 * whose text is exactly the message. Other harnesses, or a session this
 * computer can't name, are `unknown`.
 */
export async function findInClaudeHistory(spec: SessionSpec, message: string): Promise<'found' | 'missing' | 'unknown'> {
  if (harnessDefinition(spec.harness).agentexProviderId !== 'claude' || !spec.nativeSessionId) return 'unknown';
  let filePath: string;
  try {
    filePath = (await getClaudeTranscriptPath({ sessionId: spec.nativeSessionId, cwd: spec.cwd })).filePath;
  } catch {
    return 'unknown';
  }
  if (!fs.existsSync(filePath)) return 'missing';
  // The message was sent recently: the transcript's tail is enough.
  const stat = fs.statSync(filePath);
  const tailBytes = Math.min(stat.size, 4 * 1024 * 1024);
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(tailBytes);
  try {
    fs.readSync(fd, buffer, 0, tailBytes, stat.size - tailBytes);
  } finally {
    fs.closeSync(fd);
  }
  for (const line of buffer.toString('utf8').split('\n')) {
    if (!line.includes('"user"')) continue;
    let entry: { type?: string; message?: { role?: string; content?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== 'user' || entry.message?.role !== 'user') continue;
    const content = entry.message.content;
    const texts = typeof content === 'string'
      ? [content]
      : Array.isArray(content)
        ? content.flatMap((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? [(part as { text: string }).text] : []))
        : [];
    if (texts.some((text) => text === message || text.endsWith(message))) return 'found';
  }
  return 'missing';
}

/**
 * Answer the home's reads of executions placed here: only an execution this
 * computer prepared, in the worktree it prepared for it.
 */
export function executionReads(options: { journal: CommandJournal; homeId: string }): RequestHandler {
  return async (kind, payload) => {
    if (kind !== 'read_execution') throw new UnsupportedRequestError(kind);
    const request = payload as ReadExecutionRequest;
    const worktreePath = options.journal.preparedWorktree(request.executionId);
    if (!worktreePath) return { status: 404, body: { error: "This execution wasn't prepared on this computer." } };
    const source = agentFolderHere(options.homeId, request.workspace.id) ?? worktreePath;
    return readExecution(
      {
        worktreePath,
        source,
        isGit: request.workspace.isGit,
        baseBranch: request.workspace.baseBranch,
        baseSha: request.baseSha,
        filesToCopy: request.workspace.filesToCopy,
      },
      request.read,
    );
  };
}

export function executionHandlers(options: ExecutionHandlerOptions): CommandHandlers {
  const { journal } = options;
  const findInHistory = options.findInHistory ?? findInClaudeHistory;

  /** A command that's safe to repeat: after a restart it simply runs again. */
  const repeatable = (run: (command: WorkerCommand) => Promise<WorkerCommandAckBody>): CommandKindHandler => {
    const handler: CommandKindHandler = {
      async run(command, ctx) {
        if (fenced(journal, command)) return stale(command);
        ctx.markStarted();
        try {
          return await run(command);
        } catch (err) {
          return failure(err);
        }
      },
      recover: (command, _stage, ctx) => handler.run(command, ctx),
    };
    return handler;
  };

  const filesDir = (command: WorkerCommand, ctx: CommandContext) => inputFilesDir(ctx.target.homeId, chatOf(command));
  /** The text as this computer's harness gets it: this computer's path where each sent file's marker was. */
  const placedMessage = (command: WorkerCommand, ctx: CommandContext) => {
    const payload = command.payload as SendPayload;
    return placeInputFiles(payload.message, filesDir(command, ctx), payload.attachments ?? []);
  };

  const send: CommandKindHandler = {
    async run(command, ctx) {
      if (fenced(journal, command)) return stale(command);
      const payload = command.payload as SendPayload;
      // Queued while the execution was still being prepared here: its folder
      // is the worktree that prepare made, which ran first.
      if (!payload.spec.cwd && payload.spec.preparedWorktreeOf) {
        const prepared = journal.preparedWorktree(payload.spec.preparedWorktreeOf);
        if (!prepared) return { state: 'failed', error: "This execution wasn't prepared on this computer." };
        payload.spec = { ...payload.spec, cwd: prepared };
      }
      // Its files first, so the message never names one that isn't here.
      // Fetching is safe to repeat, so it happens before `started`.
      const files = payload.attachments ?? [];
      if (files.length > 0) {
        try {
          await fetchInputFiles({ target: ctx.target, commandId: command.id, dir: filesDir(command, ctx), files });
        } catch (err) {
          return failure(err);
        }
      }
      // `started` before the message goes in: from here, a crash leaves the
      // outcome to be checked against the native history, never re-sent.
      ctx.markStarted();
      try {
        const sent = await runner.send({
          chatSessionId: chatOf(command),
          message: placedMessage(command, ctx),
          turnId: payload.turnId,
          runId: payload.runId,
          spec: payload.spec,
        });
        return sent.status === 'delivered'
          ? { state: 'delivered' }
          : { state: 'failed', error: 'The session could not be started.' };
      } catch (err) {
        return failure(err);
      }
    },
    async recover(command, stage, ctx) {
      // Received but never started: the message never went in, so send it now.
      if (stage === 'received') return send.run(command, ctx);
      if (fenced(journal, command)) return stale(command);
      const payload = command.payload as SendPayload;
      const found = await findInHistory(payload.spec, placedMessage(command, ctx));
      if (found === 'found') return { state: 'delivered', result: { reconciled: true } };
      return {
        state: 'uncertain',
        error:
          found === 'missing'
            ? "The message isn't in the session's history after a restart. Retry it if it's still wanted."
            : "Delivery couldn't be checked after a restart. Retry it if it's still wanted.",
      };
    },
  };

  const answer: CommandKindHandler = {
    async run(command, ctx) {
      if (fenced(journal, command)) return stale(command);
      const { requestId, response } = command.payload as { requestId: string; response: UserInputResponse };
      ctx.markStarted();
      // The home refuses an agent approving a permission, and so does this
      // computer, on the actor the command carries.
      const answered = runner.answerPendingInput(chatOf(command), requestId, response, command.actor);
      if (answered.ok) return { state: 'delivered' };
      if (answered.refused) return { state: 'failed', error: answered.refused };
      return { state: 'stale', error: 'That prompt is no longer waiting for an answer.' };
    },
    async recover(command, _stage, ctx) {
      // A restart ended the session that asked, and its prompts with it,
      // unless the prompt is somehow still waiting.
      return answer.run(command, ctx);
    },
  };

  /**
   * Prepare an execution here: the worktree, from the agent's folder on this
   * computer, and the agent's files to copy. The worktree is noted in the
   * journal as soon as it exists, so recovery after a crash reuses it rather
   * than making a second. The setup script is not part of this: the home
   * sends it as its own `run_script`, which is never repeated.
   */
  const prepare: CommandKindHandler = {
    async run(command, ctx) {
      if (fenced(journal, command)) return stale(command);
      const payload = command.payload as PreparePayload;
      const source = agentFolderHere(ctx.target.homeId, payload.workspace.id);
      if (!source) {
        return {
          state: 'failed',
          error: `${payload.workspace.name} isn't set up on this computer. Attach its folder with \`ri setup attach\` first.`,
        };
      }
      ctx.markStarted();
      const ws: WorkspaceRecord = { ...payload.workspace, cwd: source, worktreeRoot: null };
      try {
        const noted = journal.get(command.id)?.notes as Partial<PrepareResult> | undefined;
        let result: PrepareResult;
        if (noted?.worktreePath && fs.existsSync(noted.worktreePath)) {
          result = { worktreePath: noted.worktreePath, branchName: noted.branchName ?? null, baseSha: noted.baseSha ?? null, warning: noted.warning ?? null };
        } else if (!ws.isGit || payload.live) {
          result = {
            worktreePath: source,
            branchName: ws.isGit ? await gitOut(source, ['branch', '--show-current']) : null,
            baseSha: ws.isGit ? await gitOut(source, ['rev-parse', 'HEAD']) : null,
            warning: null,
          };
        } else {
          let baseRef = payload.baseBranch;
          if (payload.prNumber !== null) baseRef = (await fetchPrHead({ ws, prNumber: payload.prNumber })).ref;
          const worktree = await createWorktreeForSession({
            ws,
            sessionId: payload.chatSessionId,
            sessionLabel: payload.label,
            baseBranchOverride: baseRef,
          });
          result = { worktreePath: worktree.path, branchName: worktree.branch, baseSha: worktree.baseSha, warning: worktree.warning };
        }
        journal.note(command.id, { ...result });
        if (result.worktreePath !== source) await copyFilesToWorktree(source, result.worktreePath, ws.filesToCopy);
        return { state: 'delivered', result };
      } catch (err) {
        return { state: 'failed', error: `${err instanceof Error ? err.name : 'Error'}: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    // Idempotent by the note: a worktree already made is reused, and copying
    // files again only overwrites them with the same content.
    recover: (command, _stage, ctx) => prepare.run(command, ctx),
  };

  /** A project script. Not idempotent: once started, it's never run again without the person asking. */
  const runScript: CommandKindHandler = {
    async run(command, ctx) {
      if (fenced(journal, command)) return stale(command);
      const payload = command.payload as SetupScriptPayload;
      const source = agentFolderHere(ctx.target.homeId, payload.workspaceId) ?? payload.worktreePath;
      ctx.markStarted();
      const outcome = await runWorktreeScript({
        command: payload.command,
        worktreePath: payload.worktreePath,
        sourceCheckoutPath: source,
        branch: payload.branchName ?? undefined,
      });
      return { state: 'delivered', result: { ok: outcome.ok, output: tail(outcome.output) } };
    },
    async recover(command, stage, ctx) {
      if (stage === 'received') return runScript.run(command, ctx);
      return {
        state: 'uncertain',
        error: "The setup script may not have finished before this computer restarted. Run it again if it's needed.",
      };
    },
  };

  return {
    send,
    prepare,
    run_script: runScript,
    interrupt: repeatable(async (command) => {
      await runner.abort(chatOf(command));
      return { state: 'delivered' };
    }),
    stop_task: repeatable(async (command) => {
      const { taskId } = command.payload as { taskId: string };
      const result = await runner.stopTask(chatOf(command), taskId);
      return { state: 'delivered', result };
    }),
    stop: repeatable(async (command) => {
      const result = await runner.close(chatOf(command));
      return result.closed ? { state: 'delivered', result } : { state: 'failed', error: result.error ?? 'The session did not close.' };
    }),
    answer_pending_input: answer,
  };
}
