/**
 * The main chat's first-run conversation, kept on the home step by step
 * (`user_state.onboarding`, src/lib/onboarding/progress.ts): each change is
 * one read-and-write, finishing fills in the rest, a message sent instead
 * skips the question on screen, and a home that finished before steps were
 * recorded counts as having seen every step there was.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { APP_SHORT_ID } from '@/constants/app';
import { ONBOARDING_STEPS, STEPS_BEFORE_RECORDS } from '@/lib/onboarding/progress';

let tmpDir: string;
let q: typeof import('@/lib/db/queries');
let db: typeof import('@/lib/db');
let schema: typeof import('@/lib/db/schema');

const appRootEnv = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
const dbPathEnv = `${APP_SHORT_ID.toUpperCase()}_DB_PATH`;
const mirrorDisabledEnv = `${APP_SHORT_ID.toUpperCase()}_MIRROR_DISABLED`;
const saveEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-onboarding-'));
  for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) saveEnv[k] = process.env[k];
  process.env[appRootEnv] = tmpDir;
  process.env[dbPathEnv] = path.join(tmpDir, 'data.db');
  process.env[mirrorDisabledEnv] = '1';
  q = await import('@/lib/db/queries');
  db = await import('@/lib/db');
  schema = await import('@/lib/db/schema');
});

afterAll(() => {
  for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) {
    if (saveEnv[k] === undefined) delete process.env[k];
    else process.env[k] = saveEnv[k];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** A home that has never started the conversation. */
function freshHome() {
  db.getDb()
    .update(schema.userState)
    .set({ onboarding: null, orchestratorIntroducedAt: null, onboardedAt: null })
    .where(eq(schema.userState.id, 1))
    .run();
}

beforeEach(freshHome);

describe('a home going through the conversation', () => {
  it('records each step where it was answered, and what was said', () => {
    q.showOnboardingStep({ step: 'identity', chatId: 'chat-1' });
    expect(q.getUserState()?.onboarding?.current).toEqual({ step: 'identity', chatId: 'chat-1' });

    const state = q.recordOnboardingStep({ step: 'identity', status: 'answered', reply: 'Rye', chatId: 'chat-1' });
    expect(state?.onboarding?.steps.identity).toMatchObject({ status: 'answered', reply: 'Rye', chatId: 'chat-1' });
    expect(state?.onboarding?.current).toBeUndefined();
    expect(state?.orchestratorIntroducedAt).toBeNull();
  });

  it('keeps every answer when two windows finish steps one after the other', () => {
    q.recordOnboardingStep({ step: 'identity', status: 'answered', reply: 'Rye', chatId: 'chat-1' });
    q.recordOnboardingStep({ step: 'you', status: 'answered', reply: 'Trey', chatId: 'chat-1' });
    expect(Object.keys(q.getUserState()?.onboarding?.steps ?? {}).sort()).toEqual(['identity', 'you']);
  });

  it('skips the question on screen when the person writes in that chat instead', () => {
    q.recordOnboardingStep({ step: 'identity', status: 'answered', reply: 'Rye', chatId: 'chat-1' });
    q.showOnboardingStep({ step: 'you', chatId: 'chat-1' });

    expect(q.skipOnboardingStepOnScreen('chat-2')).toBe(false);
    expect(q.skipOnboardingStepOnScreen('chat-1')).toBe(true);
    const record = q.getUserState()?.onboarding;
    expect(record?.steps.you).toMatchObject({ status: 'skipped', chatId: 'chat-1' });
    expect(record?.current).toBeUndefined();
    // Nothing is on screen any more, so the next message changes nothing.
    expect(q.skipOnboardingStepOnScreen('chat-1')).toBe(false);
    // Still not finished: the rest come back on the next new chat.
    expect(q.getUserState()?.orchestratorIntroducedAt).toBeNull();
  });

  it('never skips the harness step on a message', () => {
    q.showOnboardingStep({ step: 'harness', chatId: 'chat-1' });
    expect(q.skipOnboardingStepOnScreen('chat-1')).toBe(false);
    expect(q.getUserState()?.onboarding?.steps.harness).toBeUndefined();
  });

  it('moves the conversation to the chat that replaced its empty one', () => {
    q.recordOnboardingStep({ step: 'identity', status: 'answered', reply: 'Rye', chatId: 'old' });
    q.showOnboardingStep({ step: 'harness', chatId: 'old' });
    const record = q.moveOnboardingChat({ from: 'old', to: 'new' })?.onboarding;
    expect(record?.steps.identity?.chatId).toBe('new');
    expect(record?.current).toEqual({ step: 'harness', chatId: 'new' });
  });
});

describe('finishing', () => {
  it('fills in what was left, and counts a new home as introduced and set up', () => {
    q.recordOnboardingStep({ step: 'identity', status: 'answered', reply: 'Rye', chatId: 'chat-1' });
    const state = q.finishOnboarding({ skipped: false, chatId: 'chat-1' });
    expect(Object.keys(state?.onboarding?.steps ?? {}).sort()).toEqual([...ONBOARDING_STEPS].sort());
    expect(state?.onboarding?.steps.identity?.status).toBe('answered');
    expect(state?.onboarding?.steps.apps?.status).toBe('not_asked');
    expect(state?.orchestratorIntroducedAt).toBeTruthy();
    expect(state?.onboardedAt).toBeTruthy();
  });

  it('marks what was left as skipped on Skip setup, and keeps an earlier setup date', () => {
    db.getDb().update(schema.userState).set({ onboardedAt: '2026-04-30T00:00:00.000Z' }).where(eq(schema.userState.id, 1)).run();
    const state = q.finishOnboarding({ skipped: true });
    expect(state?.onboarding?.steps.apps?.status).toBe('skipped');
    expect(state?.onboardedAt).toBe('2026-04-30T00:00:00.000Z');
  });

  it('changes nothing more when it runs twice', () => {
    const first = q.finishOnboarding({ skipped: false });
    const second = q.finishOnboarding({ skipped: true });
    expect(second?.orchestratorIntroducedAt).toBe(first?.orchestratorIntroducedAt);
    expect(second?.onboarding?.steps.apps?.status).toBe('not_asked');
  });
});

describe('a home that finished before steps were recorded', () => {
  beforeEach(() => {
    db.getDb()
      .update(schema.userState)
      .set({ orchestratorIntroducedAt: '2026-10-02T00:00:00.000Z', onboardedAt: '2026-04-30T00:00:00.000Z' })
      .where(eq(schema.userState.id, 1))
      .run();
  });

  it('counts every step there was then as seen, so none goes on screen', () => {
    const state = q.showOnboardingStep({ step: 'apps', chatId: 'chat-1' });
    expect(state?.onboarding).toBeNull();
  });

  it('keeps every step it went through when its first record is written', () => {
    // A step answered later (one added since, quietly offered) is its first write.
    const state = q.recordOnboardingStep({ step: 'apps', status: 'answered', reply: 'Connected Gmail', chatId: 'chat-1' });
    expect(Object.keys(state?.onboarding?.steps ?? {}).sort()).toEqual([...STEPS_BEFORE_RECORDS].sort());
    expect(state?.onboarding?.steps.identity).toEqual({ status: 'not_asked', at: '2026-10-02T00:00:00.000Z' });
    expect(state?.onboarding?.steps.apps).toMatchObject({ status: 'answered', reply: 'Connected Gmail' });
  });
});

it('drops steps it no longer knows when reading', () => {
  db.getDb()
    .update(schema.userState)
    .set({ onboarding: { steps: { retired: { status: 'answered', at: 'x' } } } as never })
    .where(eq(schema.userState.id, 1))
    .run();
  expect(q.getUserState()?.onboarding).toEqual({ steps: {} });
});
