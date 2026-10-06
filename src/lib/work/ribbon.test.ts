import { describe, expect, it } from 'vitest';
import { activityBins, ribbonScale, sittingWindows } from './ribbon';

const at = (h: number, m = 0) => new Date(2026, 9, 1, h, m).toISOString();
const block = (agentId: string | null, h1: number, m1: number, h2: number, m2: number, sessionId = `${agentId}-${h1}${m1}`) => ({
  sessionId,
  agentId,
  start: at(h1, m1),
  end: at(h2, m2),
});
const order = (id: string | null) => ({ a: 1, b: 2 })[id ?? ''] ?? 99;

describe('activityBins', () => {
  it('counts chats per 15-minute window by agent, in stacking order', () => {
    const bins = activityBins(
      {
        date: '2026-10-01',
        blocks: [block('b', 9, 0, 9, 30), block('a', 9, 10, 9, 20), block('a', 9, 0, 9, 14, 'a2'), block(null, 9, 20, 9, 25)],
      },
      order,
    );
    expect(bins.map((b) => [b.startMinute, b.total])).toEqual([
      [540, 3],
      [555, 3],
    ]);
    // a before b before Ri (null), whatever the input order.
    expect(bins[0]!.byAgent).toEqual([
      { agentId: 'a', count: 2 },
      { agentId: 'b', count: 1 },
    ]);
    expect(bins[1]!.byAgent.map((x) => x.agentId)).toEqual(['a', 'b', null]);
  });

  it('leaves empty windows out and clamps to the day', () => {
    const bins = activityBins({ date: '2026-10-01', blocks: [block('a', 23, 50, 23, 59)] }, order);
    expect(bins.map((b) => b.startMinute)).toEqual([1425]);
    expect(activityBins({ date: '2026-10-02', blocks: [block('a', 9, 0, 10, 0)] }, order)).toEqual([]);
  });
});

describe('ribbonScale and sittings', () => {
  it('scales every day to the widest window, at least 1', () => {
    expect(ribbonScale([[{ startMinute: 0, total: 2, byAgent: [] }], [{ startMinute: 15, total: 5, byAgent: [] }]])).toBe(5);
    expect(ribbonScale([])).toBe(1);
  });

  it('turns sittings into minute windows', () => {
    expect(sittingWindows({ date: '2026-10-01', sittings: [{ start: at(9), end: at(9, 45) }] })).toEqual([{ startMinute: 540, endMinute: 585 }]);
  });
});
