import path from 'node:path';
import { expect, it } from 'vitest';
import { desktopPackageLayout } from './package-layout';

it('finds the macOS bundle executable and resources', () => {
  const root = path.resolve('release/desktop/mac-arm64/Ri.app');
  expect(desktopPackageLayout(root, 'darwin')).toEqual({ executable: path.join(root, 'Contents/MacOS/Ri'), resources: path.join(root, 'Contents/Resources') });
});
it('finds the explicitly named Linux executable and unpacked resources', () => {
  for (const directory of ['linux-unpacked', 'linux-arm64-unpacked']) {
    const root = path.resolve('release/desktop', directory);
    expect(desktopPackageLayout(root, 'linux')).toEqual({ executable: path.join(root, 'ri'), resources: path.join(root, 'resources') });
  }
});
it('refuses unsupported native packages', () => {
  expect(() => desktopPackageLayout('/package', 'win32')).toThrow('macOS and Linux');
});
