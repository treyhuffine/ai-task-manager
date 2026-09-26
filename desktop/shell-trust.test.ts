import { expect, it } from 'vitest';
import { eligibleShellFile } from './shell-trust';
import type { Release } from '../src/lib/service/release-trust';
const filename = process.platform === 'darwin' ? 'Ri.zip' : 'Ri.AppImage';
const release = { shell: { url: `https://releases.example/${filename}`, sha512: 'signed-digest', size: 100 } } as Release;
it('accepts exactly the desktop artifact authenticated by the publisher', () => {
  expect(() => eligibleShellFile(release, [{ url: filename, sha512: 'signed-digest', size: 100 }])).not.toThrow();
});
it.each([
  [{ url: `https://another.example/${filename}`, sha512: 'signed-digest', size: 100 }],
  [{ url: filename, sha512: 'attacker-digest', size: 100 }],
  [{ url: filename, sha512: 'signed-digest', size: 101 }],
  [{ url: filename, sha512: 'signed-digest', size: 100 }, { url: `other-${filename}`, sha512: 'other', size: 100 }],
])('rejects substituted or ambiguous desktop artifacts %j', (...files) => {
  expect(() => eligibleShellFile(release, files)).toThrow();
});
