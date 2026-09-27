import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { beforeEach, expect, it, vi } from 'vitest';
import { createTrayIcon } from './tray-icon';

const image = vi.hoisted(() => ({
  addRepresentation: vi.fn(),
  isEmpty: vi.fn(),
  getScaleFactors: vi.fn(),
  setTemplateImage: vi.fn(),
}));
vi.mock('electron', () => ({ nativeImage: { createEmpty: () => image } }));
const root = fileURLToPath(new URL('../', import.meta.url));
const brand = path.join(root, 'public/brand');
beforeEach(() => {
  vi.clearAllMocks();
  image.isEmpty.mockReturnValue(false);
  image.getScaleFactors.mockReturnValue([1, 2]);
});

it.each([
  ['darwin', 'ri-trayTemplate', 18],
  ['linux', 'ri-tray-linux', 24],
] as const)('loads %s raster assets with explicit density representations', async (platform, basename, size) => {
  expect(createTrayIcon(root, platform)).toBe(image);
  expect(image.addRepresentation).toHaveBeenCalledTimes(2);
  for (const [index, scaleFactor] of [1, 2].entries()) {
    const suffix = scaleFactor === 1 ? '' : '@2x';
    const png = fs.readFileSync(path.join(brand, `${basename}${suffix}.png`));
    expect(image.addRepresentation.mock.calls[index]).toEqual([{
      scaleFactor, dataURL: `data:image/png;base64,${png.toString('base64')}`,
    }]);
    const metadata = await sharp(png).metadata();
    expect([metadata.width, metadata.height]).toEqual([size * scaleFactor, size * scaleFactor]);
  }
  if (platform === 'darwin') expect(image.setTemplateImage).toHaveBeenCalledExactlyOnceWith(true);
  else expect(image.setTemplateImage).not.toHaveBeenCalled();
});

it('fails when packaging omitted the icon rather than returning an empty tray', () => {
  expect(() => createTrayIcon(path.join(root, 'desktop/tray-icon.test.ts'), 'darwin')).toThrow();
  expect(image.setTemplateImage).not.toHaveBeenCalled();
});

it('fails if Electron cannot decode the image or its Retina representation', () => {
  image.isEmpty.mockReturnValue(true);
  expect(() => createTrayIcon(root, 'darwin')).toThrow('tray icon could not be loaded');
  image.isEmpty.mockReturnValue(false);
  image.getScaleFactors.mockReturnValue([1]);
  expect(() => createTrayIcon(root, 'darwin')).toThrow('tray icon could not be loaded');
  expect(image.setTemplateImage).not.toHaveBeenCalled();
});

it.each([
  ['ri-trayTemplate', 18, '#000000'],
  ['ri-tray-linux', 24, '#181a18'],
] as const)('%s preserves the original vector path and matches both committed PNG exports', async (name, size, color) => {
  const svg = fs.readFileSync(path.join(brand, `${name}.svg`), 'utf8');
  const master = fs.readFileSync(path.join(brand, 'ri-mark.svg'), 'utf8');
  const masterPath = master.match(/<path[^>]+\/>/)![0];
  expect(svg).toContain(masterPath.replace('currentColor', color));
  expect(svg).toContain(master.match(/viewBox="([^"]+)"/)![0]);
  for (const scale of [1, 2]) {
    const suffix = scale === 1 ? '' : '@2x';
    const expected = await sharp(Buffer.from(svg)).resize(size * scale, size * scale).ensureAlpha().raw().toBuffer();
    const actual = await sharp(path.join(brand, `${name}${suffix}.png`)).ensureAlpha().raw().toBuffer();
    expect(actual.equals(expected)).toBe(true);
  }
});

it.each(['ri-trayTemplate.png', 'ri-trayTemplate@2x.png'])('%s is a transparent black silhouette with padding for template rendering', async name => {
  const { data, info } = await sharp(path.join(brand, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = 0;
  let transparent = 0;
  for (let pixel = 0; pixel < info.width * info.height; pixel++) {
    const offset = pixel * 4;
    expect([...data.subarray(offset, offset + 3)]).toEqual([0, 0, 0]);
    if (data[offset + 3] === 0) transparent++;
    if (data[offset + 3] === 255) opaque++;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) expect(data[offset + 3]).toBe(0);
  }
  expect(opaque).toBeGreaterThan(30);
  expect(transparent).toBeGreaterThan(30);
});

it.each(['ri-tray-linux.png', 'ri-tray-linux@2x.png'])('%s has its own contrasting foreground and background for Linux panels', async name => {
  const pixels = await sharp(path.join(brand, name)).ensureAlpha().raw().toBuffer();
  const colors = new Set<string>();
  for (let offset = 0; offset < pixels.length; offset += 4) colors.add(pixels.subarray(offset, offset + 4).toString('hex'));
  expect(colors.has('181a18ff')).toBe(true);
  expect(colors.has('f5f2eaff')).toBe(true);
  expect(colors.has('00000000')).toBe(true);
});
