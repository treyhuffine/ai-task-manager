import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb, getRawDb, resetDb } from '@/lib/db';
import { chatEvents } from './schema';
import { createChatSession } from './queries';
import { getWorkResultAuthorBriefEvent } from './work-result-runtime-queries';

let root: string;
beforeEach(() => {
  resetDb();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-handoff-author-brief-'));
  vi.stubEnv('RI_ROOT', root);
  vi.stubEnv('RI_DB_PATH', path.join(root, 'data.db'));
  getDb();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetDb();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('bounded original handoff request lookup', () => {
  it('finds the original request across timestamp formats and many preparation messages using the session index', () => {
    const session = createChatSession({ harness: 'codex', type: 'content' });
    const put = (id: string, at: string, raw: Record<string, unknown> | null = null, role: 'user' | 'assistant' = 'user') => {
      getDb().insert(chatEvents).values({ id, sessionId: session.id, role,
        source: role === 'user' ? 'user' : 'agent', content: id, createdAt: at, raw }).run();
    };
    put('earlier-iso-request', '2026-10-08T12:59:30.000Z');
    put('exact-original-request', '2026-10-08 12:59:50');
    for (let i = 0; i < 150; i++) {
      put(`preparation-${i.toString().padStart(3, '0')}`, '2026-10-08T12:59:59.000Z', {
        resultOperation: { kind: 'handoff_preparation', requestId: `request-${i}`,
          requestHash: 'hash', actorUserId: 'local', actorSessionId: null, messageId: `preparation-${i}` },
      });
    }
    put('selected-output', '2026-10-08T13:00:00.000Z', null, 'assistant');
    put('later-request', '2026-10-08 13:00:01');

    const sqlite = getRawDb();
    const prepare = sqlite.prepare.bind(sqlite);
    const plans: Array<Array<{ detail: string }>> = [];
    vi.spyOn(sqlite, 'prepare').mockImplementation((query: string) => {
      const statement = prepare(query);
      if (query.includes('substr(') && query.includes('chat_events')) {
        const all = statement.all.bind(statement);
        vi.spyOn(statement, 'all').mockImplementation((...params: unknown[]) => {
          plans.push(prepare(`EXPLAIN QUERY PLAN ${query}`).all(...params) as Array<{ detail: string }>);
          return all(...params);
        });
      }
      return statement;
    });

    expect(getWorkResultAuthorBriefEvent(session.id, 'selected-output')?.id).toBe('exact-original-request');
    expect(plans.length).toBeGreaterThan(2);
    for (const plan of plans) {
      expect(plan.some(({ detail }) => detail.includes('idx_chat_events_session_created'))).toBe(true);
      expect(plan.some(({ detail }) => /^SCAN chat_events\b/.test(detail))).toBe(false);
    }
  });

  it('uses capture time when the selected event is gone and returns no invented request', () => {
    const session = createChatSession({ harness: 'codex', type: 'content' });
    getDb().insert(chatEvents).values({ id: 'original', sessionId: session.id, role: 'user', source: 'user',
      content: 'Original task', createdAt: '2026-10-08T12:00:00.000Z' }).run();
    expect(getWorkResultAuthorBriefEvent(session.id, 'pruned-output', '2026-10-08 12:00:01')?.id).toBe('original');
    expect(getWorkResultAuthorBriefEvent(session.id, null, '2026-10-08T11:59:59.000Z')).toBeNull();
    expect(getWorkResultAuthorBriefEvent(session.id, null, 'invalid')).toBeNull();
  });
});
