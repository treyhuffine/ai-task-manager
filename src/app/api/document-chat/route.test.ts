import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resetDb } from '@/lib/db';
import { updateUserState } from '@/lib/db/queries';
import { GET } from './route';

// Codex's catalog comes from the installed CLI. Resolve against the bundled
// catalog so the default tuple does not depend on this machine's Codex.
vi.mock('@/lib/harness/model-discovery', async () => {
  const { explicitHarnessSelection } = await import('@/lib/harness/options');
  return {
    resolveHarnessSelection: async (
      providerId: Parameters<typeof explicitHarnessSelection>[0],
      preferred: Parameters<typeof explicitHarnessSelection>[1] = {},
    ) => explicitHarnessSelection(providerId, preferred),
  };
});

/**
 * Focused (note/task) chats seed model + effort from the user's saved defaults
 * the same way orchestrator chats do — a per-entity new chat should start with
 * the last selection, not reset to Default/Effort. Real throwaway DB; migration
 * cost is paid in the hook so cold-start doesn't flake the first test.
 */

const TEST_DB = path.join(os.tmpdir(), `ri-doc-seed-test-${process.pid}.db`);
vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });

function wipe() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

beforeEach(() => {
  wipe();
  process.env.RI_DB_PATH = TEST_DB;
  resetDb();
});

afterAll(wipe);

describe('GET /api/document-chat — seeds model + effort from defaults', () => {
  it('a fresh focused chat inherits defaultModel + defaultEffort', async () => {
    updateUserState({
      defaultHarness: 'claude',
      defaultModel: 'sonnet',
      defaultEffort: 'medium',
    });

    const req = new Request('http://test/api/document-chat?entityType=task&entityId=task_seed_1');
    const { session } = await (await GET(req)).json();
    expect(session.surfaceKind).toBe('task');
    expect(session.harness).toBe('claude');
    expect(session.model).toBe('sonnet');
    expect(session.effort).toBe('medium');
  });

  it('null defaults resolve to the Codex tuple', async () => {
    const req = new Request('http://test/api/document-chat?entityType=note&entityId=note_seed_1');
    const { session } = await (await GET(req)).json();
    expect(session.harness).toBe('codex');
    expect(session.model).toBe('gpt-6.1-sol');
    expect(session.effort).toBe('medium');
  });
});

describe('GET /api/document-chat — skill builder and try chats', () => {
  it('opens one builder chat and one try chat per skill, as separate threads', async () => {
    const { createSkillAt } = await import('@/lib/skills/library');
    const { riSkillsDir } = await import('@/lib/skills/locations');
    const dir = path.join(riSkillsDir(), 'doc-chat-skill');
    createSkillAt(dir, { description: 'D.', body: 'B\n' });
    try {
      const url = (kind: string) => `http://test/api/document-chat?entityType=${kind}&entityId=${encodeURIComponent('ri:doc-chat-skill')}`;
      const build = await (await GET(new Request(url('skill')))).json();
      const again = await (await GET(new Request(url('skill')))).json();
      const tryChat = await (await GET(new Request(url('skill-try')))).json();
      expect(build.session).toMatchObject({ type: 'content', surfaceKind: 'skill', surfaceRef: 'ri:doc-chat-skill' });
      expect(again.session.id).toBe(build.session.id);
      expect(tryChat.session).toMatchObject({ surfaceKind: 'skill-try', surfaceRef: 'ri:doc-chat-skill' });
      expect(tryChat.session.id).not.toBe(build.session.id);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a chat for a skill that does not exist, and an unknown kind', async () => {
    const missing = await GET(new Request('http://test/api/document-chat?entityType=skill&entityId=ri%3Ano-such-skill'));
    expect(missing.status).toBe(404);
    const unknown = await GET(new Request('http://test/api/document-chat?entityType=workspace&entityId=x'));
    expect(unknown.status).toBe(400);
  });
});
