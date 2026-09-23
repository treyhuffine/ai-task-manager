import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderAgentInstructionsPrompt } from './prompts/agent-instructions';

/**
 * What an execution is told at spawn (docs/agents-view-spec.md Phase 3): the
 * agent's standing instructions and the reference-folder block, composed into
 * the one `instructionsFile` agentex accepts. The adapter builds its session
 * config from exactly these functions.
 */

const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-session-instructions-'));
const previousWorkDir = process.env.RI_WORK_DIR;

beforeAll(() => {
  process.env.RI_WORK_DIR = WORK_DIR;
});

afterAll(() => {
  if (previousWorkDir === undefined) delete process.env.RI_WORK_DIR;
  else process.env.RI_WORK_DIR = previousWorkDir;
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
});

async function load() {
  return import('./session-instructions');
}

const agentBlock = renderAgentInstructionsPrompt({
  name: 'ri',
  instructions: 'Run pnpm ts before every commit.',
});

describe('renderAgentInstructionsPrompt', () => {
  it('names the agent and carries the text verbatim', () => {
    expect(agentBlock).toContain('## Standing instructions for the "ri" agent');
    expect(agentBlock).toContain('"ri", the Ri agent this work belongs to');
    expect(agentBlock.endsWith('Run pnpm ts before every commit.')).toBe(true);
  });

  it('says nothing when the agent has no instructions', () => {
    expect(renderAgentInstructionsPrompt({ name: 'ri', instructions: null })).toBe('');
    expect(renderAgentInstructionsPrompt({ name: 'ri', instructions: '  \n ' })).toBe('');
  });
});

describe('planSessionInstructions', () => {
  it('joins the non-empty blocks in order for a harness that reads session instructions', async () => {
    const { planSessionInstructions } = await load();
    const plan = planSessionInstructions('claude', [
      { name: 'agent instructions', text: agentBlock },
      { name: 'empty', text: '' },
      { name: 'reference folders', text: '## Reference folders\n- api  ->  /code/api' },
    ]);
    expect(plan.undelivered).toEqual([]);
    expect(plan.text.indexOf('Standing instructions')).toBeLessThan(plan.text.indexOf('Reference folders'));
    expect(plan.text).toBe(`${agentBlock}\n\n## Reference folders\n- api  ->  /code/api`);
  });

  it('delivers on codex too', async () => {
    const { planSessionInstructions } = await load();
    expect(planSessionInstructions('codex', [{ name: 'agent instructions', text: agentBlock }]).text).toBe(agentBlock);
  });

  it('reports what was lost on harnesses whose session path drops the file', async () => {
    const { planSessionInstructions, providerDeliversSessionInstructions } = await load();
    for (const provider of ['cursor', 'opencode']) {
      expect(providerDeliversSessionInstructions(provider)).toBe(false);
      expect(planSessionInstructions(provider, [
        { name: 'agent instructions', text: agentBlock },
        { name: 'reference folders', text: '' },
      ])).toEqual({ text: '', undelivered: ['agent instructions'] });
    }
  });

  it('produces nothing when no block has anything to say', async () => {
    const { planSessionInstructions } = await load();
    expect(planSessionInstructions('claude', [
      { name: 'agent instructions', text: renderAgentInstructionsPrompt({ name: 'ri', instructions: null }) },
    ])).toEqual({ text: '', undelivered: [] });
  });
});

describe('the session instructions file', () => {
  it('is written under the work dir, keyed by chat session, and removed on close', async () => {
    const { writeSessionInstructions, sessionInstructionsPath, clearSessionInstructions } = await load();
    const file = writeSessionInstructions('chat-1', agentBlock);
    expect(file).toBe(sessionInstructionsPath('chat-1'));
    expect(file.startsWith(WORK_DIR)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe(`${agentBlock}\n`);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);

    // Rewritten on every build, so it always matches current settings.
    writeSessionInstructions('chat-1', 'updated');
    expect(fs.readFileSync(file, 'utf8')).toBe('updated\n');

    clearSessionInstructions('chat-1');
    expect(fs.existsSync(file)).toBe(false);
    // Clearing twice is harmless.
    expect(() => clearSessionInstructions('chat-1')).not.toThrow();
  });
});
