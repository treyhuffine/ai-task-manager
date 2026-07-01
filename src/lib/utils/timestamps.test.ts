import { describe, expect, it } from 'vitest';
import { normalizeTimestamp, timestampEpoch } from './timestamps';

describe('normalizeTimestamp', () => {
  it('coerces SQLite space-format to explicit-UTC ISO', () => {
    expect(normalizeTimestamp('2026-06-29 22:00:00')).toBe('2026-06-29T22:00:00Z');
  });

  it('keeps a fractional SQLite datetime', () => {
    expect(normalizeTimestamp('2026-06-29 22:00:00.500')).toBe('2026-06-29T22:00:00.500Z');
  });

  it('leaves ISO strings untouched', () => {
    expect(normalizeTimestamp('2026-06-29T22:00:00.000Z')).toBe('2026-06-29T22:00:00.000Z');
  });

  it('leaves non-datetime strings untouched', () => {
    expect(normalizeTimestamp('not-a-date')).toBe('not-a-date');
  });
});

describe('timestampEpoch', () => {
  it('reads SQLite space-format as UTC, not local time', () => {
    // Must equal the same instant expressed as ISO — no UTC-offset skew.
    expect(timestampEpoch('2026-06-29 22:00:00')).toBe(
      Date.parse('2026-06-29T22:00:00.000Z'),
    );
  });

  it('orders a later space-format value above an earlier ISO value', () => {
    // The exact cross-format trap: raw string compare would invert these
    // because ' ' < 'T'. Epochs put them in real-time order.
    const spaceLater = timestampEpoch('2026-06-29 22:00:00');
    const isoEarlier = timestampEpoch('2026-06-29T21:00:00.000Z');
    expect(spaceLater).toBeGreaterThan(isoEarlier);
  });

  it('floors null/undefined/unparseable to -Infinity', () => {
    expect(timestampEpoch(null)).toBe(Number.NEGATIVE_INFINITY);
    expect(timestampEpoch(undefined)).toBe(Number.NEGATIVE_INFINITY);
    expect(timestampEpoch('garbage')).toBe(Number.NEGATIVE_INFINITY);
  });
});
