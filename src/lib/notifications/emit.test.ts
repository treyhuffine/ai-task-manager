/**
 * What a finished run's notification says, against a real (temp) home: the turn's own reply,
 * whole for channels with room for it and as one line for the rest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import type { ChatSessionRecord, NotificationChannelRecord } from '@/db/types';
import { runTerminalNotification } from './emit';
import { render } from './render';
import { FULL_BODY_MAX, LINE_BODY_MAX } from './message-text';

vi.mock('@agentex/agent', () => ({}));

let home: TestHome;
let chat: ChatSessionRecord;
let clock: number;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-notify-emit-' });
  const workspace = q.createWorkspace({ name: 'App', cwd: home.root, isGit: false, filesToCopy: [] });
  chat = q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'claude', label: 'Fix auth' }).session;
  clock = Date.parse('2026-10-21T10:00:00.000Z');
});

afterEach(async () => {
  await home.cleanup();
});

type EventInput = Partial<Parameters<typeof q.insertChatEvent>[0]>;

function event(input: EventInput) {
  clock += 1000;
  return q.insertChatEvent({ sessionId: chat.id, role: 'assistant', source: 'agent', createdAt: new Date(clock).toISOString(), ...input });
}

const prompt = (content: string) => event({ role: 'user', source: 'user', content });
const reply = (content: string) => event({ content });
const toolCall = () => event({ source: 'tool_call', toolName: 'Bash' });

function finishedRun(outcome: 'completed' | { errorMessage: string } = 'completed') {
  const run = q.createRun({ harness: 'claude', triggerKind: 'manual', status: 'queued', chatSessionId: chat.id, executionId: chat.executionId });
  q.markRunStarted(run.id);
  if (outcome === 'completed') q.markRunCompleted(run.id);
  else q.markRunFailed(run.id, { errorCode: 'agent_error', errorMessage: outcome.errorMessage });
  return runTerminalNotification(run.id)!.event;
}

function channel(kind: NotificationChannelRecord['kind']): NotificationChannelRecord {
  return { id: 'c1', kind, providerId: kind === 'integration' ? 'telegram' : null, config: {}, events: [], enabled: true, userId: 'local' } as unknown as NotificationChannelRecord;
}

describe('runTerminalNotification', () => {
  it('carries the turn’s whole reply, with entities named, and one line of it as the body', () => {
    const task = q.createTask({ title: 'Ship the token refresh' });
    prompt('Fix the auth bug');
    toolCall();
    reply('Working on it.');
    toolCall();
    reply(`## Done\n\nAdded **token refresh**. Tests pass.\n\n- Created [[task:${task.id}]]\n- Opened PR #12`);

    const evt = finishedRun();
    expect(evt.title).toBe('✅ Fix auth');
    expect(evt.fullBody).toBe('Done\n\nAdded token refresh. Tests pass.\n\n• Created Ship the token refresh\n• Opened PR #12');
    expect(evt.body).toBe('Done Added token refresh. Tests pass. • Created Ship the token refresh • Opened PR #12');
  });

  it('leaves fullBody off when the one-line body already says it all', () => {
    prompt('Status?');
    reply('All green.');
    const evt = finishedRun();
    expect(evt.body).toBe('All green.');
    expect(evt).not.toHaveProperty('fullBody');
  });

  it('never sends an earlier turn’s reply for a turn that wrote none', () => {
    prompt('First');
    reply('The first answer.');
    prompt('Second');
    toolCall();
    expect(finishedRun().body).toBe('Execution completed.');
  });

  it('skips a subagent’s text for the turn’s own', () => {
    prompt('Research it');
    reply('Asked a subagent.');
    event({ content: 'Subagent findings.', externalParentToolCallId: 'toolu_1' });
    expect(finishedRun().body).toBe('Asked a subagent.');
  });

  it('says why a run failed when its turn wrote nothing', () => {
    prompt('Go');
    toolCall();
    expect(finishedRun({ errorMessage: 'You hit your session limit.' }).body).toBe('You hit your session limit.');
  });

  it('carries a long reply whole', () => {
    const text = Array.from({ length: 80 }, (_, i) => `Paragraph ${i} ${'detail '.repeat(10)}ends here.`).join('\n\n');
    prompt('Write it all');
    reply(text);
    const evt = finishedRun();
    expect(evt.fullBody).toBe(text);
    expect(evt.body.length).toBeLessThanOrEqual(LINE_BODY_MAX);
    expect(evt.body.length).toBeGreaterThan(LINE_BODY_MAX - 100);
  });

  it('cuts only a runaway reply, past every real one', () => {
    prompt('Paste the log');
    reply(Array.from({ length: 2000 }, (_, i) => `Line ${i} of the log output.`).join('\n\n'));
    const evt = finishedRun();
    expect(evt.fullBody!.length).toBeLessThanOrEqual(FULL_BODY_MAX);
    expect(evt.fullBody!.length).toBeGreaterThan(FULL_BODY_MAX - 100);
    expect(evt.fullBody).toMatch(/output\. …$/);
  });
});

describe('render', () => {
  it('gives a message channel the whole reply and an OS notification the line', () => {
    prompt('Go');
    reply('Done.\n\n- One\n- Two');
    const evt = finishedRun();
    expect(render(evt, channel('integration')).body).toBe('Done.\n\n• One\n• Two');
    expect(render(evt, channel('web_push')).body).toBe('Done. • One • Two');
    expect(render(evt, channel('in_app')).body).toBe('Done. • One • Two');
  });
});
