import fs from 'node:fs';
import path from 'node:path';
import { nativeImage, type NativeImage } from 'electron';

/**
 * Call after Electron is ready. `repo` is the same source or staged server root
 * used for public/brand/ri-desktop-icon.png. These small PNGs are copied with
 * public assets, so loading needs neither SVG support nor a runtime rasterizer.
 * See public/brand/ri-tray-assets.md for source geometry and regeneration.
 */
export function createTrayIcon(repo: string, platform: NodeJS.Platform = process.platform): NativeImage {
  const template = platform === 'darwin';
  const basename = template ? 'ri-trayTemplate' : 'ri-tray-linux';
  const icon = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2]) {
    const suffix = scaleFactor === 1 ? '' : '@2x';
    const png = fs.readFileSync(path.join(repo, 'public/brand', `${basename}${suffix}.png`));
    icon.addRepresentation({ scaleFactor, dataURL: `data:image/png;base64,${png.toString('base64')}` });
  }
  // Failing visibly lets the caller keep a normal window if a package omitted
  // the tray assets. Never hide the app behind an empty, unreachable icon.
  if (icon.isEmpty() || ![1, 2].every(scale => icon.getScaleFactors().includes(scale))) {
    throw new Error('Ri tray icon could not be loaded.');
  }
  if (template) icon.setTemplateImage(true);
  return icon;
}
