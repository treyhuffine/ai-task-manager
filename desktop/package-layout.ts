import path from 'node:path';

/** Paths for an unpacked matching-platform application, not an installer. */
export function desktopPackageLayout(directory: string, platform: NodeJS.Platform = process.platform) {
  const root = path.resolve(directory);
  if (platform === 'darwin') return { executable: path.join(root, 'Contents/MacOS/Ri'), resources: path.join(root, 'Contents/Resources') };
  if (platform === 'linux') return { executable: path.join(root, 'ri'), resources: path.join(root, 'resources') };
  throw new Error('Packaged desktop tests support macOS and Linux.');
}
