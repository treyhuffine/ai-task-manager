/**
 * How this device's worker carries out execution commands
 * (docs/homes-build.md, P2 protocol and P2.4): send, interrupt, stop a task,
 * stop, and answer a prompt, each through the local runner, with the
 * placement fence and the recovery rule from "Command receipt and recovery".
 *
 * Fencing: every execution command carries the placement generation the home
 * had when it queued it. A generation older than the newest this device
 * has seen for that execution is `stale`, and nothing happens.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { UserInputResponse } from '@agentex/agent';
import type { WorkspaceRecord } from '@/db/types';
import { copyFilesToWorktree } from '@/lib/workspaces/files-to-copy';
import { archiveSessionWorktree, buildWorktreeLeaf, createWorktreeForSession, defaultWorktreeRoot, fetchPrHead, openWorktreeHandle, resumeWorktreeForSession, runWorktreeScript } from '@/lib/workspaces/index';
import { getClaudeTranscriptPath } from '@agentex/agent';
import { harnessDefinition } from '@/lib/harness/registry';
import { ExecutorError } from '@/lib/runner/errors';
import * as runner from '@/lib/runner/local-runner';
import type { SessionSpec } from '@/lib/runner/types';
import { HOME_ADDRESS_SCHEME, type OpenHereRequest, type ReviewCheckoutRequest, type ReadAgentFolderRequest, type ReadExecutionRequest, type SendPayload, type WorkerCommand, type WorkerCommandAckBody, type WriteExecutionRequest } from '@/lib/workers/protocol';
import { readExecution, type ExecutionLocation } from '@/lib/workspaces/execution-reads';
import { writeExecution, writeFolder } from '@/lib/workspaces/execution-writes';
import { readAgentFolder } from '@/lib/workspaces/agent-folder-reads';
import type { CommandJournal } from './command-journal';
import type { CommandContext, CommandHandlers, CommandKindHandler } from './commands';
import { agentFolderHere } from './agent-folder';
import type { WorkerTerminals } from './terminals';
import type { EventJournal } from './event-journal';
import { CheckpointError, saveCheckpoint, worktreeAtCheckpoint } from '@/lib/transfer/git-checkpoint';
import { hasBackgroundTasks, isRunning } from '@/lib/runner/live-state';
import { openHere } from './open-here';
import { reviewHere } from '@/lib/transfer/review';
import { runGithub, type GithubRequest } from '@/lib/github/execution-github';
import { pullBaseInto, pullUpstreamInto, pushExecutionBranch } from '@/lib/workspaces/branch-sync';
import { looksLikeNonFastForward } from '@/lib/workspaces/git-errors';
import { uncommittedFilesOf } from '@/lib/workspaces/uncommitted-files';
import { fetchInputFiles, inputFilesDir, placeInputFiles } from './input-files';
import { UnsupportedRequestError, type RequestHandler } from './run';
import { applySetupHere, planSetupHere, SetupError, type SetupAgentRequest } from '@/lib/setups/set-up-here';
import { checkFoldersHere, FolderListingError, listFoldersHere } from '@/lib/setups/folders-here';
import type { CheckFoldersRequest, ListFoldersRequest, WriteAgentFolderRequest } from '@/lib/workers/protocol';

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
  /**
   * Continue here (P4.2): prepare at a published checkpoint for a transfer,
   * on its branch at its exact commit, rather than start a new branch. The
   * home keeps what comes of it to the transfer, not the execution.
   */
  transfer?: { id: string; checkpoint: { remote: string; branch: string; sha: string } };
  /**
   * Reopened after it was archived (P4.5): its worktree again, on its own
   * branch, where it was, as the home does for its own.
   */
  resume?: { branch: string; baseSha: string | null };
}

/**
 * A Git operation on an execution's worktree here (P4.2, P4.5): the
 * checkpoint a transfer publishes, a push, bringing in the base branch or
 * what was pushed to the branch elsewhere, or removing the worktree when the
 * execution is archived.
 */
export type GitPayload =
  | { op: 'checkpoint'; message: string; includeUntracked: string[]; filesToCopy: string[]; transferId?: string }
  | { op: 'push'; workspaceId?: string }
  | { op: 'pull_base'; strategy: 'merge' | 'rebase'; workspaceId: string; baseBranch?: string | null }
  | { op: 'pull_upstream'; strategy: 'merge' | 'rebase'; workspaceId: string }
  | { op: 'archive_worktree'; force: boolean; teardownCommand: string | null; workspaceId: string };

/** Stopping everything an execution runs here, for a transfer (P4.2). */
export interface QuiescePayload {
  chatSessionIds: string[];
  transferId: string;
}

export interface PrepareResult {
  worktreePath: string;
  branchName: string | null;
  baseSha: string | null;
  warning: string | null;
  /**
   * A new worktree was made. False for live mode or a folder that isn't a
   * repository, where the work happens in the agent's folder itself, and
   * nothing meant for a fresh worktree (the setup script, copied files)
   * belongs there.
   */
  isolated: boolean;
}

export interface SetupScriptPayload {
  script: 'setup';
  workspaceId: string;
  command: string;
  worktreePath: string;
  branchName: string | null;
}

/**
 * The home's servers in a spec, at the address this worker reaches its home
 * by: the home sends them as `ri-home:` and a path (P2.7).
 */
export function atHome(spec: SessionSpec, homeUrl: string): SessionSpec {
  const base = homeUrl.replace(/\/+$/, '');
  return {
    ...spec,
    mcpServers: (spec.mcpServers ?? []).map((server) =>
      server.type === 'http' && server.url?.startsWith(HOME_ADDRESS_SCHEME)
        ? { ...server, url: `${base}${server.url.slice(HOME_ADDRESS_SCHEME.length)}` }
        : server,
    ),
  };
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
  /** This worker's terminals, which a transfer stops with the rest (P4.2). */
  terminals?: Pick<WorkerTerminals, 'releaseExecution'>;
  /** Where this worker's event journal stands, so a stop reports only once the home has everything. */
  events?: Pick<EventJournal, 'lastPosition' | 'ackedPosition'>;
  /** Post pending events now. */
  flushEvents?: () => void;
  /** How long a stop waits for its last events to reach the home. */
  flushTimeoutMs?: number;
  /** Whether the chat's native history holds this message. Defaults to reading Claude's transcript. */
  findInHistory?: (spec: SessionSpec, message: string) => Promise<'found' | 'missing' | 'unknown'>;
}

function stale(command: WorkerCommand): WorkerCommandAckBody {
  return { state: 'stale', error: `This command was for an earlier placement (generation ${command.target.generation}).` };
}

/**
 * Whether this command's placement is no longer this device's: a newer
 * one has reached it, or the home released this one (a heartbeat's reply,
 * journaled).
 */
function fenced(journal: CommandJournal, command: WorkerCommand): boolean {
  const { executionId, generation } = command.target;
  if (!executionId || generation === null) return false;
  if (journal.released(executionId, generation)) return true;
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
 * device can't name, are `unknown`.
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
 * Answer the home's reads and changes of executions placed here: only an
 * execution this device prepared, in the worktree it prepared for it. A
 * change also has to be for the placement this device still holds: once
 * the home has moved the execution on, its files here are left alone.
 */
export function executionRequests(options: { journal: CommandJournal; homeId: string }): RequestHandler {
  const { journal, homeId } = options;
  const locate = (request: ReadExecutionRequest | WriteExecutionRequest): ExecutionLocation | null => {
    const worktreePath = journal.preparedWorktree(request.executionId);
    if (!worktreePath) return null;
    return {
      worktreePath,
      source: agentFolderHere(homeId, request.workspace.id) ?? worktreePath,
      isGit: request.workspace.isGit,
      baseBranch: request.workspace.baseBranch,
      remoteName: request.workspace.remoteName ?? null,
      baseSha: request.baseSha,
      filesToCopy: request.workspace.filesToCopy,
    };
  };
  const notPrepared = { status: 404, body: { error: "This execution wasn't prepared on this device." } };
  return async (kind, payload) => {
    if (kind === 'read_execution') {
      const request = payload as ReadExecutionRequest;
      const location = locate(request);
      return location ? readExecution(location, request.read) : notPrepared;
    }
    if (kind === 'write_execution') {
      const request = payload as WriteExecutionRequest;
      const { executionId, generation } = request;
      const newest = journal.highestGeneration(executionId);
      if (journal.released(executionId, generation) || (newest !== null && generation < newest)) {
        return { status: 409, body: { error: 'moved', message: 'This execution no longer runs on this device.' } };
      }
      const location = locate(request);
      return location ? writeExecution(location, request.write) : notPrepared;
    }
    if (kind === 'github') {
      const { workspaceId, request } = payload as { workspaceId: string; request: GithubRequest };
      const folder = agentFolderHere(homeId, workspaceId);
      if (!folder) return { status: 409, body: { error: 'not_set_up', message: "This agent isn't set up on this device." } };
      return runGithub(folder, request);
    }
    if (kind === 'review_checkout') {
      const request = payload as ReviewCheckoutRequest;
      return reviewHere({
        repo: agentFolderHere(homeId, request.workspace.id),
        executionId: request.executionId,
        workspaceSlug: request.workspace.slug,
        branch: request.branch,
        sourceName: request.sourceName,
      });
    }
    if (kind === 'open_here') {
      return openHere(payload as OpenHereRequest, { journal, agentFolder: (agentId) => agentFolderHere(homeId, agentId) });
    }
    if (kind === 'read_agent_folder') {
      const request = payload as ReadAgentFolderRequest;
      const folder = agentFolderHere(homeId, request.agentId);
      if (!folder) return { status: 409, body: { error: 'not_set_up', message: "This agent isn't set up on this device." } };
      return readAgentFolder(folder, request.filesToCopy, request.read);
    }
    if (kind === 'write_agent_folder') {
      const request = payload as WriteAgentFolderRequest;
      const folder = agentFolderHere(homeId, request.agentId);
      if (!folder) return { status: 409, body: { error: 'not_set_up', message: "This agent isn't set up on this device." } };
      if (!checkFoldersHere([folder])[0]!.exists) {
        return { status: 409, body: { error: `The agent's folder does not exist: ${folder}` } };
      }
      return writeFolder({ path: folder, kind: request.isGit ? 'git' : 'bare' }, request.write);
    }
    if (kind === 'check_folders') {
      return { status: 200, body: { results: checkFoldersHere((payload as CheckFoldersRequest).paths ?? []) } };
    }
    if (kind === 'list_folders') {
      try {
        return { status: 200, body: listFoldersHere((payload as ListFoldersRequest).path ?? null) };
      } catch (err) {
        if (err instanceof FolderListingError) return { status: 400, body: { error: 'folders', message: err.message } };
        throw err;
      }
    }
    if (kind === 'setup_agent') {
      // Setting an agent up here from the app: its project copied down, or a
      // folder already here, the same setup `ri setup attach` makes. Only for
      // this device's own home.
      const request = payload as SetupAgentRequest;
      if (request.homeId !== homeId) {
        return { status: 409, body: { error: 'wrong_home', message: 'This device runs agents for a different Ri.' } };
      }
      try {
        if (request.op === 'plan') return { status: 200, body: planSetupHere(request) };
        return { status: 200, body: await applySetupHere(request) };
      } catch (err) {
        if (err instanceof SetupError) return { status: 400, body: { error: 'setup', message: err.message } };
        throw err;
      }
    }
    throw new UnsupportedRequestError(kind);
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
  /** The text as this device's harness gets it: this device's path where each sent file's marker was. */
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
        if (!prepared) return { state: 'failed', error: "This execution wasn't prepared on this device." };
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
          spec: atHome(payload.spec, ctx.target.homeUrl),
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
      // device, on the actor the command carries.
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
   * device, and the agent's files to copy. The worktree is noted in the
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
          error: `${payload.workspace.name} isn't set up on this device. Set it up in ${payload.workspace.name}'s Setup, under Folders, or with \`ri setup attach\` here.`,
        };
      }
      if (!checkFoldersHere([source])[0]!.exists) {
        return {
          state: 'failed',
          error: `${payload.workspace.name}'s folder, ${source}, isn't there any more. Choose where it is now in ${payload.workspace.name}'s Setup, under Folders.`,
        };
      }
      ctx.markStarted();
      const ws: WorkspaceRecord = { ...payload.workspace, cwd: source, worktreeRoot: null };
      try {
        const noted = journal.get(command.id)?.notes as Partial<PrepareResult> | undefined;
        let result: PrepareResult;
        if (payload.transfer) {
          // Continue here: the checkpoint's branch at its exact commit, in the
          // worktree this device already had for the execution when it ran
          // it before, or a new one.
          const earlier = command.target.executionId ? journal.preparedWorktree(command.target.executionId) : null;
          const target =
            noted?.worktreePath ??
            (earlier && earlier !== source ? earlier : path.join(ws.worktreeRoot ?? defaultWorktreeRoot(ws.slug), buildWorktreeLeaf(ws.slug, payload.chatSessionId)));
          const made = await worktreeAtCheckpoint({ repo: source, path: target, checkpoint: payload.transfer.checkpoint });
          result = { worktreePath: made.path, branchName: made.branch, baseSha: made.sha, warning: null, isolated: true };
        } else if (payload.resume && !noted?.worktreePath) {
          const earlier = command.target.executionId ? journal.preparedWorktree(command.target.executionId) : null;
          const target = earlier && earlier !== source ? earlier : path.join(ws.worktreeRoot ?? defaultWorktreeRoot(ws.slug), buildWorktreeLeaf(ws.slug, payload.chatSessionId));
          const resumed = fs.existsSync(target)
            ? { path: target, branch: payload.resume.branch, baseSha: payload.resume.baseSha ?? '', warning: null }
            : await resumeWorktreeForSession({ ws, worktreePath: target, branch: payload.resume.branch, baseSha: payload.resume.baseSha ?? '', sessionId: payload.chatSessionId });
          const made = resumed ?? (await createWorktreeForSession({ ws, sessionId: payload.chatSessionId, sessionLabel: payload.label, baseBranchOverride: payload.baseBranch }));
          result = { worktreePath: made.path, branchName: made.branch, baseSha: made.baseSha || null, warning: made.warning, isolated: true };
        } else if (noted?.worktreePath && fs.existsSync(noted.worktreePath)) {
          result = {
            worktreePath: noted.worktreePath,
            branchName: noted.branchName ?? null,
            baseSha: noted.baseSha ?? null,
            warning: noted.warning ?? null,
            isolated: noted.isolated ?? noted.worktreePath !== source,
          };
        } else if (!ws.isGit || payload.live) {
          result = {
            worktreePath: source,
            branchName: ws.isGit ? await gitOut(source, ['branch', '--show-current']) : null,
            baseSha: ws.isGit ? await gitOut(source, ['rev-parse', 'HEAD']) : null,
            warning: null,
            isolated: false,
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
          result = {
            worktreePath: worktree.path,
            branchName: worktree.branch,
            baseSha: worktree.baseSha,
            warning: worktree.warning,
            isolated: true,
          };
        }
        journal.note(command.id, { ...result });
        if (result.isolated) await copyFilesToWorktree(source, result.worktreePath, ws.filesToCopy);
        return { state: 'delivered', result };
      } catch (err) {
        if (err instanceof CheckpointError) return { state: 'failed', error: err.message, result: { code: err.code } };
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
        error: "The setup script may not have finished before this device restarted. Run it again if it's needed.",
      };
    },
  };

  /**
   * Stop everything an execution runs here, for a transfer (P4.2, spec
   * §8.2 step 3 and 4): each chat's harness closed and confirmed gone, its
   * background tasks with it, and its terminals. Acknowledged only once
   * everything its sessions reported has reached the home, so the home's
   * conversation checkpoint is complete. Safe to run again.
   */
  const quiesce: CommandKindHandler = {
    async run(command, ctx) {
      if (fenced(journal, command)) return stale(command);
      const payload = command.payload as QuiescePayload;
      ctx.markStarted();
      const problems: string[] = [];
      for (const chat of payload.chatSessionIds) {
        const report = await runner.close(chat);
        if (!report.closed && report.error) problems.push(report.error);
        if (runner.isHarnessSessionAlive(chat) || isRunning(chat) || hasBackgroundTasks(chat)) {
          problems.push('A session there is still running.');
        }
      }
      const terminals = command.target.executionId ? await options.terminals?.releaseExecution(command.target.executionId) ?? 0 : 0;
      if (problems.length > 0) return { state: 'failed', error: `It couldn't be stopped there: ${[...new Set(problems)].join(' ')}` };
      const upTo = options.events?.lastPosition() ?? 0;
      options.flushEvents?.();
      const deadline = Date.now() + (options.flushTimeoutMs ?? 30_000);
      while ((options.events?.ackedPosition() ?? upTo) < upTo) {
        if (Date.now() > deadline) return { state: 'failed', error: "Its last events didn't reach the home in time." };
        await new Promise((r) => setTimeout(r, 100));
        options.flushEvents?.();
      }
      return { state: 'delivered', result: { closed: payload.chatSessionIds, terminals, eventPosition: upTo } };
    },
    recover: (command, _stage, ctx) => quiesce.run(command, ctx),
  };

  /** Git on an execution's worktree here (P4.2, P4.5). Refused once its placement has moved on. */
  const gitCommand: CommandKindHandler = {
    async run(command, ctx) {
      if (fenced(journal, command)) return stale(command);
      const payload = command.payload as GitPayload;
      const executionId = command.target.executionId;
      const worktree = executionId ? journal.preparedWorktree(executionId) : null;
      if (!worktree || !fs.existsSync(worktree)) return { state: 'failed', error: "This execution's worktree isn't on this device." };
      ctx.markStarted();
      try {
        switch (payload.op) {
          case 'checkpoint':
            return {
              state: 'delivered',
              result: await saveCheckpoint({ worktree, message: payload.message, includeUntracked: payload.includeUntracked, filesToCopy: payload.filesToCopy }),
            };
          case 'push': {
            const source = (payload.workspaceId && agentFolderHere(ctx.target.homeId, payload.workspaceId)) || worktree;
            const handle = await openWorktreeHandle({ worktreePath: worktree }, { cwd: source, baseBranch: null, remoteName: null });
            if (!handle || handle.kind !== 'git') return { state: 'failed', error: "The worktree isn't a Git repository." };
            await pushExecutionBranch(handle);
            return { state: 'delivered', result: { pushed: true } };
          }
          case 'pull_base': {
            const source = agentFolderHere(ctx.target.homeId, payload.workspaceId) ?? worktree;
            const handle = await openWorktreeHandle({ worktreePath: worktree }, { cwd: source, baseBranch: payload.baseBranch ?? null, remoteName: null });
            if (!handle || handle.kind !== 'git') return { state: 'failed', error: "The worktree isn't a Git repository." };
            await pullBaseInto(handle, { strategy: payload.strategy, baseBranch: payload.baseBranch ?? null });
            return { state: 'delivered', result: { pulled: true } };
          }
          case 'pull_upstream': {
            const source = agentFolderHere(ctx.target.homeId, payload.workspaceId) ?? worktree;
            const handle = await openWorktreeHandle({ worktreePath: worktree }, { cwd: source, baseBranch: null, remoteName: null });
            if (!handle || handle.kind !== 'git') return { state: 'failed', error: "The worktree isn't a Git repository." };
            await pullUpstreamInto(handle, { strategy: payload.strategy });
            return { state: 'delivered', result: { pulled: true } };
          }
          case 'archive_worktree': {
            const source = agentFolderHere(ctx.target.homeId, payload.workspaceId) ?? worktree;
            if (worktree === source) return { state: 'delivered', result: { removed: false } };
            await archiveSessionWorktree({
              session: { worktreePath: worktree },
              teardownCommand: payload.teardownCommand,
              sourceCheckoutPath: source,
              force: payload.force,
            });
            return { state: 'delivered', result: { removed: true } };
          }
        }
      } catch (err) {
        const code =
          err instanceof CheckpointError
            ? err.code
            : payload.op === 'push' && looksLikeNonFastForward(err)
              ? 'non_fast_forward'
              : (payload.op === 'pull_base' || payload.op === 'pull_upstream') && (err as { name?: string }).name === 'MergeConflictError'
                ? 'merge_conflict'
                : payload.op === 'archive_worktree' && (err as { name?: string }).name === 'DirtyWorktreeError'
                  ? 'dirty_worktree'
                  : (err as { name?: string }).name;
        // A refused archive names the files it would have deleted, for the person deciding.
        const list = code === 'dirty_worktree' ? uncommittedFilesOf(err) : null;
        return { state: 'failed', error: err instanceof Error ? err.message : String(err), result: list ? { code, ...list } : { code } };
      }
    },
    // Each is safe to repeat: a checkpoint finds its commit, a push has
    // nothing left, a merged base or upstream has nothing to bring in, and
    // a removed worktree is gone.
    recover: (command, _stage, ctx) => gitCommand.run(command, ctx),
  };

  return {
    send,
    prepare,
    quiesce,
    git: gitCommand,
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
