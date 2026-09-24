import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { describeHomeUse, setAsideUnusedHome } from './set-aside';

let home: TestHome;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-set-aside-' });
  const { resolveHomeIdentity, resetHomeIdentityCache } = await import('./identity');
  resetHomeIdentityCache();
  resolveHomeIdentity();
});

afterEach(async () => {
  const { resetHomeIdentityCache } = await import('./identity');
  resetHomeIdentityCache();
  await home.cleanup();
});

describe('setting aside a home started by mistake', () => {
  it('moves an empty, never-onboarded home aside, deleting nothing', async () => {
    const { resetDb } = await import('@/lib/db');
    resetDb();
    expect(describeHomeUse().unused).toBe(true);
    const dest = setAsideUnusedHome();
    expect(fs.existsSync(home.dbPath)).toBe(false);
    expect(fs.existsSync(path.join(dest, 'data.db'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'machine.json'))).toBe(true);
    expect(fs.existsSync(path.join(home.configDir, 'machine.json'))).toBe(false);
  });

  it('never touches a home with anything in it', async () => {
    const { createTask } = await import('@/lib/db/queries');
    createTask({ title: 'Real work' });
    const { resetDb } = await import('@/lib/db');
    resetDb();
    expect(describeHomeUse()).toMatchObject({ unused: false, counts: expect.objectContaining({ tasks: 1 }) });
    expect(() => setAsideUnusedHome()).toThrow(/has data in it/);
    expect(fs.existsSync(home.dbPath)).toBe(true);
  });

  it('treats a finished onboarding as use', async () => {
    const { updateUserState } = await import('@/lib/db/queries');
    updateUserState({ onboardedAt: new Date().toISOString() });
    const { resetDb } = await import('@/lib/db');
    resetDb();
    expect(describeHomeUse().unused).toBe(false);
  });
});
