import { expect, it } from 'vitest';
import { teamDisplayName } from './team-display-name';
it('disambiguates equal names by address, then stable ID when the addresses also match', () => {
  const homes = [{ id: 'a', name: 'Acme', url: 'https://one.example' }, { id: 'b', name: 'Acme', url: 'https://two.example' }];
  expect(teamDisplayName('a', homes)).toBe('Acme (one.example)'); expect(teamDisplayName('b', homes)).toBe('Acme (two.example)');
  homes[1].url = homes[0].url;
  expect(teamDisplayName('a', homes)).toBe('Acme (a)'); expect(teamDisplayName('b', homes)).toBe('Acme (b)');
});
