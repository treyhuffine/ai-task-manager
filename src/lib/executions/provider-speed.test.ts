import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readProviderSpeed, writeProviderSpeed } from './provider-speed';
const saved = new Map<string, string>();
beforeEach(() => {
  saved.clear(); vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());
it('preserves personal speed preferences and isolates each Team Home and viewer', () => {
  const maya = { homeId: 'team-a', viewerId: 'maya' }, owner = { ...maya, viewerId: 'owner' }, other = { ...maya, homeId: 'team-b' };
  writeProviderSpeed('codex', 'priority'); expect(saved.get('ri.agent.speed.v1')).toBe('{"codex":"priority"}');
  for (const scope of [maya, owner, other]) expect(readProviderSpeed('codex', scope)).toBeNull();
  writeProviderSpeed('codex', 'flex', maya);
  expect(readProviderSpeed('codex', maya)).toBe('flex'); expect(readProviderSpeed('codex')).toBe('priority');
  expect(readProviderSpeed('codex', owner)).toBeNull(); expect(readProviderSpeed('codex', other)).toBeNull();
});
