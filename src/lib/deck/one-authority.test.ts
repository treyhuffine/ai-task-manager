/**
 * One deck authority (P3.6, spec §7): every screen reads the deck from the
 * home, which makes today's deck once however many screens open it at the
 * same moment, and whatever asked first. The morning refresh is the home's
 * own scheduled run, at home. (That a worker never reaches the scheduler or
 * the deck is `runner/boundary.test.ts`.) The AI pipeline is stubbed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';

const generateDeck = vi.fn();
vi.mock('@/lib/ai/generate-deck', () => ({ generateDeck: (...args: unknown[]) => generateDeck(...args) }));
vi.mock('@/lib/deck/calendar-connector', () => ({ ensureCalendarProvider: () => {} }));

let home: TestHome;
let fake: FakeHarness;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-deck-authority-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  fake = installFakeHarness('claude');
  generateDeck.mockReset();
  generateDeck.mockImplementation(async (_context: unknown, opts: { origin: string }) => {
    // Long enough for every screen's request to arrive while it runs.
    await new Promise((r) => setTimeout(r, 80));
    const q = await import('@/lib/db/queries');
    const { todayLocalDate } = await import('./date');
    return q.supersedeAndInsertDeck({ forDate: todayLocalDate(), origin: opts.origin, items: [], alternatives: [] } as never);
  });
});

afterEach(async () => {
  fake.restore();
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

async function openDeck(): Promise<{ id: string; origin: string }> {
  const { GET } = await import('@/app/api/deck/route');
  const { NextRequest } = await import('next/server');
  const res = await GET(new NextRequest('http://127.0.0.1/api/deck'));
  return res.json();
}

describe("today's deck", () => {
  it('is made once when several screens open it at the same moment, and a refresh keeps it', async () => {
    const [phone, laptop, desktop] = await Promise.all([openDeck(), openDeck(), openDeck()]);
    expect(new Set([phone.id, laptop.id, desktop.id]).size).toBe(1);
    expect(phone.origin).toBe('first_open');
    expect(generateDeck).toHaveBeenCalledTimes(1);
    expect((await openDeck()).id).toBe(phone.id);
    expect(generateDeck).toHaveBeenCalledTimes(1);
  });

  it('is made once whichever asks first, a screen or the morning refresh', async () => {
    const { ensureTodaysDeck } = await import('./ensure-todays-deck');
    const [screen, morning] = await Promise.all([openDeck(), ensureTodaysDeck({ origin: 'morning' })]);
    expect(morning.id).toBe(screen.id);
    expect(generateDeck).toHaveBeenCalledTimes(1);
  });

  it('is refreshed in the morning by a run at home, whatever computers are connected', async () => {
    const q = await import('@/lib/db/queries');
    const grant = q.createComputerGrant({ kind: 'enroll', computerId: null, computerName: 'MacBook', createdByApiKeyId: null });
    q.redeemEnrollGrant({ secret: grant.secret, name: 'MacBook' });
    const { ensureMorningDeckTrigger } = await import('./trigger');
    ensureMorningDeckTrigger();
    const { RESERVED_TRIGGER_IDS } = await import('@/lib/triggers/reserved');
    const trigger = q.getTrigger(RESERVED_TRIGGER_IDS.morningDeck)!;
    expect(trigger).toMatchObject({ targetKind: 'orchestrator', kind: 'cron', enabled: true });
    const { dispatchRun } = await import('@/lib/runs/dispatch');
    const { chatSession } = await dispatchRun({ trigger, triggerKind: 'cron', scheduledFor: new Date().toISOString() });
    expect(q.chatPlacement(chatSession!.id)).toMatchObject({ isHome: true });
  });
});
