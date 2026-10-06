/**
 * Seeded chat transcripts, written the way a real harness turn is: each step
 * becomes the agentex `StreamEvent` a harness would emit, parsed by the
 * runner's own `parseStreamEvent` and stored through `insertChatEvent`. So a
 * seeded transcript renders, sorts, counts as an outcome and marks a chat
 * unread exactly as a live one does.
 *
 * A script is a list of steps. Time moves forward a few seconds per step
 * (more for tools that take a while, `gapMin` minutes before a user message),
 * starting at `startAt`. Each turn ends with a `result` event carrying its
 * cost and duration, as Claude and Codex report them.
 */

import { uuidv7 } from 'uuidv7';
import type { StreamEvent } from '@agentex/agent';
import type { Attachment, ChatSessionRecord } from '../../src/db/types';
import { ms, plus } from './time';

export type Step =
  /** A message from Maya. `gapMin` is the pause before it (default 1). */
  | { user: string; gapMin?: number; attachments?: Attachment[] }
  /** A reasoning block. Claude's arrive redacted, so text is usually empty. */
  | { think: string }
  /** The agent's visible reply text. */
  | { say: string }
  /** One tool call and its result. `seconds` is how long the tool ran. */
  | { tool: string; input: unknown; result: string; error?: boolean; exitCode?: number; seconds?: number };

export interface TranscriptSpec {
  harness: 'claude' | 'codex';
  model: string;
  cwd: string;
  startAt: string;
  steps: Step[];
  /** Cost reported per turn, in USD. Codex reports none. */
  costPerTurn?: number;
  /**
   * How slowly the agent works: every agent step's duration is multiplied by
   * this. Default 6, which puts a ten-tool session at roughly 15 minutes, as
   * real ones take.
   */
  pace?: number;
}

export interface TranscriptResult {
  firstAt: string;
  /** When Maya sent the first message (she was looking then). */
  firstUserAt: string | null;
  lastAt: string;
  /** Id of the last visible agent reply, for reviews. */
  lastAgentEventId: string | null;
}

const CLAUDE_TOOLS = ['Task', 'Bash', 'Glob', 'Grep', 'Read', 'Edit', 'Write', 'TodoWrite', 'WebFetch', 'WebSearch'];

type Queries = typeof import('../../src/lib/db/queries');
type Parse = typeof import('../../src/lib/runner/parse');

export async function writeTranscript(session: ChatSessionRecord, spec: TranscriptSpec): Promise<TranscriptResult> {
  const q: Queries = await import('../../src/lib/db/queries');
  const { parseStreamEvent }: Parse = await import('../../src/lib/runner/parse');

  const nativeSessionId = uuidv7();
  const providerType = spec.harness;
  let t = spec.startAt;
  let turnStartedAt = t;
  let turnHasAgent = false;
  let messageId = `msg_${uuidv7().replaceAll('-', '').slice(0, 24)}`;
  let lastSay = '';
  let lastAgentEventId: string | null = null;
  let turns = 0;
  let firstUserAt: string | null = null;
  const firstAt = t;
  const pace = spec.pace ?? 6;

  const base = () => ({
    timestamp: t,
    providerType,
    sessionId: nativeSessionId,
    messageId,
    eventId: uuidv7(),
    turnId: null,
    parentToolCallId: null,
  });
  const emit = (event: Record<string, unknown>) => {
    const row = parseStreamEvent(session.id, event as unknown as StreamEvent);
    if (!row) return null;
    return q.insertChatEvent(row);
  };
  const wait = (seconds: number) => { t = plus(t, seconds * ms.second); };
  /** Agent time, scaled by the pace. */
  const advance = (seconds: number) => wait(seconds * pace);
  const newMessage = () => { messageId = `msg_${uuidv7().replaceAll('-', '').slice(0, 24)}`; };
  const endTurn = () => {
    if (!turnHasAgent) return;
    advance(1);
    turns++;
    emit({
      ...base(),
      type: 'result',
      text: lastSay,
      costUsd: spec.harness === 'claude' ? Number(((spec.costPerTurn ?? 0.18) * (0.6 + (turns % 3) * 0.35)).toFixed(4)) : null,
      isError: false,
      stopReason: spec.harness === 'claude' ? 'end_turn' : null,
      terminalReason: 'completed',
      numTurns: turns,
      durationMs: new Date(t).getTime() - new Date(turnStartedAt).getTime(),
      messageId: null,
    });
    turnHasAgent = false;
  };

  if (spec.harness === 'claude') {
    emit({ ...base(), type: 'system', subtype: 'init', model: spec.model, cwd: spec.cwd, tools: CLAUDE_TOOLS, permissionMode: 'bypassPermissions', messageId: null });
  }

  for (const step of spec.steps) {
    if ('user' in step) {
      endTurn();
      // The first message opens the transcript. Later ones come after a pause.
      if (firstUserAt) wait((step.gapMin ?? 1) * 60);
      q.insertChatEvent({
        sessionId: session.id,
        role: 'user',
        source: 'user',
        content: step.user,
        ...(step.attachments ? { attachments: step.attachments } : {}),
        createdAt: t,
      });
      firstUserAt ??= t;
      turnStartedAt = t;
      newMessage();
      advance(3);
    } else if ('think' in step) {
      emit({ ...base(), type: 'thinking', text: step.think });
      advance(4);
    } else if ('say' in step) {
      const row = emit({ ...base(), type: 'assistant', text: step.say });
      if (row) lastAgentEventId = row.id;
      lastSay = step.say;
      turnHasAgent = true;
      advance(2);
    } else {
      const toolCallId = spec.harness === 'codex' ? `exec-${uuidv7()}` : `toolu_${uuidv7().replaceAll('-', '').slice(0, 24)}`;
      emit({ ...base(), type: 'tool_call', toolCallId, name: step.tool, input: step.input });
      advance(step.seconds ?? 2);
      emit({
        ...base(),
        type: 'tool_result',
        toolCallId,
        toolName: step.tool,
        content: step.result,
        isError: step.error ?? false,
        exitCode: step.exitCode ?? (spec.harness === 'codex' ? 0 : null),
      });
      turnHasAgent = true;
      newMessage();
      advance(2);
    }
  }
  endTurn();
  return { firstAt, firstUserAt, lastAt: t, lastAgentEventId };
}

/** Shorthand for the common Claude tools, so scripts read like a session. */
export const tools = {
  bash: (command: string, result: string, description?: string, seconds = 3): Step => ({
    tool: 'Bash', input: { command, ...(description ? { description } : {}) }, result, seconds,
  }),
  read: (filePath: string, result: string): Step => ({ tool: 'Read', input: { file_path: filePath }, result, seconds: 1 }),
  edit: (filePath: string, oldString: string, newString: string): Step => ({
    tool: 'Edit', input: { file_path: filePath, old_string: oldString, new_string: newString },
    result: `The file ${filePath} has been updated successfully.`, seconds: 1,
  }),
  write: (filePath: string, content: string): Step => ({
    tool: 'Write', input: { file_path: filePath, content }, result: `File created successfully at: ${filePath}`, seconds: 1,
  }),
  grep: (pattern: string, result: string, searchPath?: string): Step => ({
    tool: 'Grep', input: { pattern, ...(searchPath ? { path: searchPath } : {}), output_mode: 'content', '-n': true }, result, seconds: 1,
  }),
  todos: (items: Array<[string, 'pending' | 'in_progress' | 'completed']>): Step => ({
    tool: 'TodoWrite',
    input: { todos: items.map(([content, status]) => ({ content, status, activeForm: content })) },
    result: 'Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress.',
    seconds: 1,
  }),
  /** A Ri orchestrator action called over MCP. */
  ri: (action: string, input: unknown, result: unknown): Step => ({
    tool: `mcp__orchestrator__${action}`, input, result: JSON.stringify(result), seconds: 1,
  }),
  /** A Codex shell command. */
  shell: (command: string, result: string, exitCode = 0, seconds = 3): Step => ({
    tool: 'command_execution', input: `/bin/zsh -lc '${command.replaceAll("'", `'\\''`)}'`, result, exitCode, error: exitCode !== 0, seconds,
  }),
};
