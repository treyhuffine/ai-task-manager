/** Export the checked-in vector master. Run with `pnpm exec node scripts/generate-brand-assets.mjs`. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const brand = path.join(root, 'public/brand');
const icons = path.join(root, 'assets/brand/icons');
await fs.mkdir(icons, { recursive: true });
const master = await fs.readFile(path.join(brand, 'ri-mark.svg'), 'utf8');
const viewBox = master.match(/viewBox="([^"]+)"/)[1];
const markPath = master.match(/<path[^>]+\/>/)[0];
const [, , markWidth, markHeight] = viewBox.split(' ').map(Number);
const ink = '#181a18';
const paper = '#f5f2ea';

function mark(x, y, width, color) {
  return `<svg x="${x}" y="${y}" width="${width}" height="${width * markHeight / markWidth}" viewBox="${viewBox}">${markPath.replace('currentColor', color)}</svg>`;
}

function icon(background, color, inset = 0, radius = 0) {
  const width = inset ? 650 : 710;
  const height = width * markHeight / markWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><title>Ri</title><rect x="${inset}" y="${inset}" width="${1024 - inset * 2}" height="${1024 - inset * 2}" rx="${radius}" fill="${background}"/>${mark((1024 - width) / 2, (1024 - height) / 2, width, color)}</svg>\n`;
}

async function render(svg, size, destination) {
  const png = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  if (destination) await fs.writeFile(destination, png);
  return png;
}

// ICO supports PNG payloads on modern Windows and browsers. Each directory
// entry points to a complete PNG, with 0 representing a 256px dimension.
async function ico(svg, sizes, destination) {
  const pngs = await Promise.all(sizes.map((size) => render(svg, size)));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + 16 * index;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(pngs[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += pngs[index].length;
  });
  await fs.writeFile(destination, Buffer.concat([header, ...pngs]));
}

const light = icon(paper, ink);
const dark = icon(ink, paper);
const desktop = icon(paper, ink, 64, 194);
for (const [name, svg] of [['ri-app-icon', light], ['ri-app-icon-dark', dark], ['ri-desktop-icon', desktop]]) {
  await fs.writeFile(path.join(brand, `${name}.svg`), svg);
  await render(svg, 1024, path.join(brand, `${name}.png`));
}

for (const [name, color] of [['black', '#000000'], ['white', '#ffffff']]) {
  const svg = master.replace('currentColor', color);
  await fs.writeFile(path.join(brand, `ri-mark-${name}.svg`), svg);
  await sharp(Buffer.from(svg)).resize({ width: 1582 }).png().toFile(path.join(brand, `ri-mark-${name}.png`));
}
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  await render(desktop, size, path.join(icons, `icon-${size}.png`));
}
await ico(desktop, [16, 24, 32, 48, 64, 128, 256], path.join(icons, 'icon.ico'));
// Favicon uses more of its tiny canvas than the desktop icon.
const favicon = icon(paper, ink, 0, 160);
await ico(favicon, [16, 32, 48], path.join(root, 'src/app/favicon.ico'));
await fs.writeFile(path.join(root, 'src/app/icon.svg'), favicon);
await render(light, 180, path.join(root, 'src/app/apple-icon.png'));

const tray = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">${mark(2, (22 - 18 * markHeight / markWidth) / 2, 18, '#000000')}</svg>\n`;
await fs.writeFile(path.join(icons, 'tray-template.svg'), tray);
await render(tray, 22, path.join(icons, 'trayTemplate.png'));
await render(tray, 44, path.join(icons, 'trayTemplate@2x.png'));

if (process.platform === 'darwin') {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ri-icon-'));
  try {
    const iconset = path.join(temp, 'Ri.iconset');
    await fs.mkdir(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      await render(desktop, size, path.join(iconset, `icon_${size}x${size}.png`));
      await render(desktop, size * 2, path.join(iconset, `icon_${size}x${size}@2x.png`));
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(icons, 'icon.icns')]);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
} else {
  console.info('ICNS export needs macOS iconutil. The checked-in ICNS is unchanged.');
}

const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760">
<rect width="1200" height="760" fill="${paper}"/>
<g font-family="Helvetica, Arial, sans-serif" fill="${ink}">
<text x="48" y="64" font-size="26" font-weight="600">Ri / Identity assets</text>
<text x="48" y="94" font-size="15" fill="#6b7069">Original silhouette. True vector paths. Tight bounds for use in the app.</text>
<rect x="48" y="128" width="534" height="284" rx="18" fill="#ffffff"/>
<rect x="606" y="128" width="546" height="284" rx="18" fill="${ink}"/>
${mark(220, 163, 215, ink)}${mark(770, 163, 215, paper)}
<text x="72" y="388" font-size="13" fill="#6b7069">TIGHT MARK / LIGHT SURFACES</text>
<text x="630" y="388" font-size="13" fill="${paper}">TIGHT MARK / DARK SURFACES</text>
<rect x="48" y="442" width="202" height="202" rx="18" fill="#dfe2da"/>
<svg x="48" y="442" width="202" height="202" viewBox="0 0 1024 1024">${desktop.replace(/^.*?<title>/, '<title>').replace(/<\/svg>\s*$/, '')}</svg>
<svg x="280" y="452" width="182" height="182" viewBox="0 0 1024 1024">${dark.replace(/^.*?<title>/, '<title>').replace(/<\/svg>\s*$/, '')}</svg>
<text x="62" y="677" font-size="13" fill="#6b7069">DESKTOP / WARM WHITE</text>
<text x="280" y="677" font-size="13" fill="#6b7069">SQUARE MASTER / DARK</text>
<rect x="528" y="452" width="624" height="182" rx="18" fill="${ink}"/>
${mark(560, 487, 44, paper)}
<text x="624" y="514" font-size="17" fill="${paper}">Welcome to Ri</text>
<text x="560" y="576" font-size="14" fill="#aeb3aa">You   ·   Areas   ·   Agent   ·   Import   ·   Launch</text>
<rect x="560" y="598" width="548" height="3" rx="1.5" fill="#393d37"/>
<rect x="560" y="598" width="110" height="3" rx="1.5" fill="${paper}"/>
<text x="528" y="677" font-size="13" fill="#6b7069">QUIET ONBOARDING PLACEMENT</text>
<text x="48" y="731" font-size="13" fill="#6b7069">SVG + transparent PNG · macOS ICNS · Windows ICO · Linux PNG · monochrome tray icons</text>
</g></svg>`;
await fs.writeFile(path.join(root, 'assets/brand/preview.svg'), preview);
await sharp(Buffer.from(preview)).png().toFile(path.join(root, 'assets/brand/preview.png'));
console.info('Exported brand assets, desktop icons, favicon, touch icon, and preview.');
