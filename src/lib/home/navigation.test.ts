import { expect, it } from 'vitest';
import { restoredHomeNavigation } from './navigation';

it('restores each Home independently without moving an execution to another owner', () => {
  expect(restoredHomeNavigation('team-12345', '/space/team-12345?view=notes&note=one')).toBe('/space/team-12345?view=notes&note=one');
  expect(restoredHomeNavigation(null, '/?view=execution&session=personal')).toBe('/?view=execution&session=personal');
  expect(restoredHomeNavigation('team-12345', '/?view=execution&session=personal')).toBeNull();
  expect(restoredHomeNavigation(null, '/space/team-12345?view=chat&chat=shared')).toBeNull();
  expect(restoredHomeNavigation('team-12345', '/space/team-123456?view=chat')).toBeNull();
});

it.each(['https://elsewhere.invalid/', '//elsewhere.invalid/', '/\\elsewhere.invalid/', '/space/%E0%A4%A', '/#token=private'])(
  'ignores an invalid or foreign navigation receipt %s', saved => {
    expect(restoredHomeNavigation('team-12345', saved)).toBeNull();
  },
);
