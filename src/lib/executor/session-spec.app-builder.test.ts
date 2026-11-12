/**
 * A personal app's builder chat (docs/personal-apps.md "Building and changing apps" and "What Ri
 * brings"): it works with Ri's Node, the pnpm Ri carries and the computer's git, first on its PATH,
 * so the person needs no developer tools.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { getWorkDir } from '@/lib/config/paths';
import * as q from '@/lib/db/queries';
import { buildSessionSpec, type SessionSpecInput } from './session-spec';

vi.setConfig({ testTimeout: 60_000 });

let home: TestHome;
let fake: FakeHarness;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-spec-app-builder-' });
  fake = installFakeHarness('claude');
});

afterEach(async () => {
  fake.restore();
  await home.cleanup();
});

function input(over: Partial<SessionSpecInput>): SessionSpecInput {
  return {
    chatSessionId: q.createChatSession({ type: 'content', harness: 'claude', status: 'active' }).id,
    harness: 'claude', cwd: home.root, sessionType: 'content', workspaceId: null, surfaceKind: null, surfaceRef: null,
    existingExternalSessionId: null, permissionMode: 'auto_all', prePlanMode: null, model: null, modelVariant: null, effort: null,
    ...over,
  };
}

describe('the app builder chat', () => {
  it('puts what Ri brings for apps first on its PATH: the carried pnpm, and Ri\'s own Node', async () => {
    const folder = fs.mkdtempSync(path.join(home.root, 'app-'));
    const source = q.createAppSource({ name: 'Tide Log', folder, createdByRi: true });
    const spec = await buildSessionSpec(input({ surfaceKind: 'app-builder', surfaceRef: source.id }));
    const parts = spec.env.PATH!.split(path.delimiter);
    const bin = path.join(getWorkDir(), 'app-tools', 'bin');
    expect(parts[0]).toBe(bin);
    expect(parts[1]).toBe(path.dirname(process.execPath));
    expect(fs.readFileSync(path.join(bin, 'pnpm'), 'utf8')).toContain(process.execPath);
    // Ri's own `ri` launcher stays on the PATH too.
    expect(parts.some((part) => part.endsWith(`${path.sep}bin`) && part !== bin)).toBe(true);
    expect(spec.instructions).toContain('Tide Log');
  });

  it('leaves every other chat\'s PATH alone', async () => {
    const spec = await buildSessionSpec(input({ sessionType: 'orchestration' }));
    expect(spec.env.PATH ?? '').not.toContain(path.join('app-tools', 'bin'));
  });
});
