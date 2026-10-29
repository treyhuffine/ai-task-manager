import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

/** The person's scratchpad in the query layer (docs/scratchpad.md). */

let home: TestHome;
beforeEach(async () => { home = await createTestHome({ prefix: 'ri-scratchpad-' }); });
afterEach(async () => { await home.cleanup(); });

describe('scratchpad', () => {
  it('has none until the first save, then keeps one row', async () => {
    const q = await import('./queries');
    expect(q.getScratchpad()).toBeNull();
    const first = q.saveScratchpad('Quotes', '');
    expect(first).toMatchObject({ merged: false, record: { id: 1, body: 'Quotes' } });
    expect(first.record.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    q.saveScratchpad('Quotes\n\nmore', 'Quotes');
    expect(q.getScratchpad()).toMatchObject({ id: 1, body: 'Quotes\n\nmore' });
  });

  it('merges a save started from text another device has since changed', async () => {
    const q = await import('./queries');
    q.saveScratchpad('Quotes', '');
    q.saveScratchpad('Quotes\n\nfrom the phone', 'Quotes');
    const desk = q.saveScratchpad('Quotes\n\nfrom the desk', 'Quotes');
    expect(desk).toMatchObject({ merged: true, record: { body: 'Quotes\n\nfrom the phone\n\nfrom the desk' } });
    expect(q.getScratchpad()?.body).toBe('Quotes\n\nfrom the phone\n\nfrom the desk');
  });

  it('leaves the row alone when a save changes nothing', async () => {
    const q = await import('./queries');
    const saved = q.saveScratchpad('Same', '').record;
    const again = q.saveScratchpad('Same', 'Same');
    expect(again).toEqual({ merged: false, record: saved });
  });

  it('can be emptied', async () => {
    const q = await import('./queries');
    q.saveScratchpad('Gone soon', '');
    expect(q.saveScratchpad('', 'Gone soon').record.body).toBe('');
  });

  it('never shows up in the user state agents and the deck read', async () => {
    const q = await import('./queries');
    q.saveScratchpad('Private jotting', '');
    expect(JSON.stringify(q.getUserState() ?? {})).not.toContain('Private jotting');
  });
});
