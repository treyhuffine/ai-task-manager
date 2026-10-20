/** A source render can pass while a server bundler replaces createRequire.
 * Exercise the emitted server code with a resolver rooted outside its bundle. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { afterEach, expect, it, vi } from 'vitest';
import { makePdf } from '@/test/fixtures/pdf';

const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack') as {
  webpack(options: unknown, callback: (error: Error | null, stats?: { hasErrors(): boolean; toString(): string }) => void): void;
};
let root: string;
afterEach(() => { vi.unstubAllEnvs(); if (root) fs.rmSync(root, { recursive: true, force: true }); });

it('renders a PDF through webpack without rewriting the installation-owned Node resolver', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-pdf-bundle-'));
  vi.stubEnv('RI_ROOT', path.join(root, 'home'));
  vi.stubEnv('RI_CONFIG_DIR', '');
  vi.stubEnv('RI_WORK_DIR', '');
  vi.stubEnv('RI_RUNTIME_REPO', process.cwd());
  const entry = path.join(root, 'entry.js');
  await build({ entryPoints: [path.resolve('src/lib/attachments/pdf-render.ts')], outfile: entry,
    bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22' });
  await new Promise<void>((resolve, reject) => webpack({ mode: 'development', devtool: false, target: 'node', entry,
    resolve: { modules: [path.resolve('node_modules'), 'node_modules'] },
    module: { parser: { javascript: { createRequire: true } } },
    output: { path: root, filename: 'server.cjs', library: { type: 'commonjs2' } },
  }, (error, stats) => {
    if (error) reject(error);
    else if (stats?.hasErrors()) reject(new Error(stats.toString()));
    else resolve();
  }));
  const { renderPdfPage, pdfVersion, PDF_THUMBNAIL_WIDTH } = require(path.join(root, 'server.cjs')) as typeof import('./pdf-render');
  const file = path.join(root, 'sample.pdf');
  fs.writeFileSync(file, makePdf(['The bundled resolver works']));
  const rendered = await renderPdfPage(file, await pdfVersion(file), { page: 1, width: PDF_THUMBNAIL_WIDTH });
  expect(rendered.pages).toBe(1);
  expect(rendered.bytes.length).toBeGreaterThan(100);
}, 30_000);
