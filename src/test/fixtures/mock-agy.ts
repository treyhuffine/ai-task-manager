/**
 * A stand-in Antigravity CLI (`agy`) for tests that drive the real agentex
 * `antigravity` provider through Ri, without a Google sign-in.
 *
 * `installMockAgy()` writes an executable script to a temp dir and points
 * `ANTIGRAVITY_COMMAND` at it, which is how Ri hands a command override to the
 * harness (`src/lib/harness/runtime.ts`). The script answers the read-only
 * probes the provider runs (`--version`, `--help`, `models`) and speaks the
 * documented headless protocol for sessions: NDJSON user messages on stdin
 * (`--input-format stream-json`), and `init`, `step_update` and one `result`
 * per turn on stdout (`--output-format stream-json`). See
 * https://antigravity.google/docs/cli/headless.
 *
 * Every spawn appends its argv, and every session its stdin lines, to logs
 * beside the script, so a test can assert exactly which flags Ri's config
 * became. `setSignedIn(false)` makes `models` fail the way an unauthenticated
 * CLI does. Agentex starts CLIs with an allow-listed environment, so the
 * script takes its settings from its own folder rather than from env vars.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MOCK_AGY_MODELS = [
  { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
  { id: 'gemini-3.1-pro-high', name: 'Gemini 3.1 Pro (High)' },
] as const;

const SCRIPT = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname;
const args = process.argv.slice(2);
const argsLog = path.join(dir, 'args.ndjson');
const stdinLog = path.join(dir, 'stdin.ndjson');
fs.appendFileSync(argsLog, JSON.stringify(args) + '\n');
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? null : null;
};

if (args.includes('--version')) {
  console.log('1.2.14');
  process.exit(0);
}
if (args.includes('--help')) {
  console.log([
    'Usage of agy:',
    '  --conversation                  Resume a previous conversation by ID',
    '  --dangerously-skip-permissions  Auto-approve all tool permission requests without prompting',
    '  --effort                        Reasoning effort for the current CLI session (low|medium|high|max)',
    '  --input-format                  Input format for print mode (text, stream-json)',
    '  --mode                          Set the agent execution mode for this session (accept-edits, plan)',
    '  --model                         Model for the current CLI session',
    '  --output-format                 Output format for print mode (text, json, stream-json) (default text)',
  ].join('\n'));
  process.exit(0);
}
if (args[0] === 'models') {
  if (args.includes('--output-format')) {
    process.stderr.write('Error: flags provided but not defined: -output-format\n');
    process.exit(2);
  }
  if (fs.existsSync(path.join(dir, 'signed-out'))) {
    process.stderr.write('Error: Please sign in to view available models. Launch the CLI without arguments to sign in.\n');
    process.exit(1);
  }
  const models = JSON.parse(fs.readFileSync(path.join(dir, 'models.json'), 'utf8'));
  console.log(models.map((m) => m.id.padEnd(28) + m.name).join('\n'));
  process.exit(0);
}
if (flag('--input-format') !== 'stream-json' || flag('--output-format') !== 'stream-json') {
  process.stderr.write('mock agy only speaks stream-json\n');
  process.exit(1);
}

const conversationId = flag('--conversation') || 'mock-conv-' + process.pid;
const write = (event) => process.stdout.write(JSON.stringify(event) + '\n');
let step = 0;
let turns = 0;
let initSent = false;
const usage = { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 };

function turn(content) {
  if (!initSent) {
    initSent = true;
    write({
      event: 'init',
      conversation_id: conversationId,
      init: {
        cwd: process.cwd(),
        tools: ['run_command', 'write_to_file', 'view_file'],
        permission_mode: args.includes('--dangerously-skip-permissions') ? 'always-proceed' : 'request-review',
        ...(flag('--model') ? { model: flag('--model') } : {}),
      },
    });
  }
  turns += 1;
  write({ event: 'step_update', step_update: { conversation_id: conversationId, step_index: step++, state: 'DONE', step_type: 'user_input' } });
  const reply = 'agy heard: ' + content.split('\n').pop();
  usage.input_tokens += 100;
  usage.output_tokens += 10;
  usage.total_tokens = usage.input_tokens + usage.output_tokens;
  write({ event: 'step_update', step_update: { conversation_id: conversationId, step_index: step++, state: 'DONE', step_type: 'agent_response', text_delta: reply } });
  write({ event: 'result', result: { conversation_id: conversationId, status: 'SUCCESS', response: reply, duration_seconds: turns, num_turns: turns, usage } });
}

let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    fs.appendFileSync(stdinLog, line + '\n');
    const message = JSON.parse(line);
    if (message.event !== 'user') continue;
    const content = message.message.content;
    turn(typeof content === 'string' ? content : content.map((block) => block.text).join(''));
  }
});
process.stdin.on('end', () => process.exit(0));
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));
`;

export interface MockAgy {
  /** Absolute path of the stand-in executable. */
  command: string;
  /** argv of every spawn, oldest first. */
  spawns(): string[][];
  /** Session spawns only (no `--version`, `--help` or `models` probes). */
  sessionSpawns(): string[][];
  /** Every NDJSON line written to a session's stdin, parsed. */
  stdin(): Array<{ event: string; message: { content: unknown } }>;
  /** Make `agy models` report a missing sign-in, or a working one. */
  setSignedIn(value: boolean): void;
  /** Remove the script and restore `ANTIGRAVITY_COMMAND`. */
  cleanup(): void;
}


function readLines(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

export function installMockAgy(options: { signedIn?: boolean } = {}): MockAgy {
  // realpath: macOS hands out /var/... for /private/var/..., and the command
  // is compared against what the probe reports.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-mock-agy-')));
  // `.cjs` so `require` works whatever package.json sits above the temp dir.
  const command = path.join(dir, 'agy.cjs');
  fs.writeFileSync(command, SCRIPT, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(MOCK_AGY_MODELS));
  const signedOutMarker = path.join(dir, 'signed-out');
  const setSignedIn = (value: boolean) => {
    if (value) fs.rmSync(signedOutMarker, { force: true });
    else fs.writeFileSync(signedOutMarker, '');
  };
  setSignedIn(options.signedIn !== false);
  const saved = process.env.ANTIGRAVITY_COMMAND;
  process.env.ANTIGRAVITY_COMMAND = command;

  const spawns = () => readLines(path.join(dir, 'args.ndjson')).map((line) => JSON.parse(line) as string[]);
  return {
    command,
    spawns,
    sessionSpawns: () => spawns().filter((argv) => argv.includes('--input-format')),
    stdin: () => readLines(path.join(dir, 'stdin.ndjson')).map((line) => JSON.parse(line)),
    setSignedIn,
    cleanup() {
      if (saved === undefined) delete process.env.ANTIGRAVITY_COMMAND;
      else process.env.ANTIGRAVITY_COMMAND = saved;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
