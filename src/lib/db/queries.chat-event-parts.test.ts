import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SHORT_ID } from '@/constants/app';

describe('cumulative chat event parts', () => {
  let directory: string;
  const dbEnv = `${APP_SHORT_ID.toUpperCase()}_DB_PATH`;
  const rootEnv = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
  const previous: Record<string, string | undefined> = {};

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-event-parts-'));
    previous[dbEnv] = process.env[dbEnv];
    previous[rootEnv] = process.env[rootEnv];
    process.env[dbEnv] = path.join(directory, 'data.db');
    process.env[rootEnv] = directory;
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of [dbEnv, rootEnv]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('replaces cumulative text in one stable row instead of dropping the tail', async () => {
    const queries = await import('./queries');
    const agent = queries.getOrCreateDefaultExecutor('opencode');
    const session = queries.createChatSession({ agentId: agent.id, type: 'execution', userId: 'local' });
    const base = {
      sessionId: session.id,
      role: 'assistant',
      source: 'agent',
      externalEventId: 'opencode-part-1',
      sourcePartIndex: 0,
    };

    queries.replaceChatEventPart({ ...base, content: 'Hello' });
    queries.replaceChatEventPart({ ...base, content: 'Hello world' });

    const rows = queries.listChatEvents(session.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe('Hello world');
  });
});
