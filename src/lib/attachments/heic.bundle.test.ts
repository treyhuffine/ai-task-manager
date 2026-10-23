/** A source conversion can pass while a server bundler replaces createRequire.
 * Exercise the emitted server code with a resolver rooted outside its bundle. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import sharp from 'sharp';
import { afterEach, expect, it, vi } from 'vitest';
import { HEIC_PHOTO } from '@/test/fixtures/heic';

const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack') as {
  webpack(options: unknown, callback: (error: Error | null, stats?: { hasErrors(): boolean; toString(): string }) => void): void;
};
let root: string;
afterEach(() => { vi.unstubAllEnvs(); if (root) fs.rmSync(root, { recursive: true, force: true }); });

it('converts a HEIC photo through webpack, loading libheif from the installation', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-heic-bundle-'));
  vi.stubEnv('RI_RUNTIME_REPO', process.cwd());
  const entry = path.join(root, 'entry.js');
  await build({ entryPoints: [path.resolve('src/lib/attachments/heic.ts')], outfile: entry,
    bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22' });
  await new Promise<void>((resolve, reject) => webpack({ mode: 'development', devtool: false, target: 'node', entry,
    resolve: { modules: [path.resolve('node_modules'), 'node_modules'] },
    module: { parser: { javascript: { createRequire: true } } },
    // Next keeps sharp, a native addon, out of server bundles too. The bundle sits outside the checkout.
    externals: { sharp: `commonjs ${require.resolve('sharp')}` },
    output: { path: root, filename: 'server.cjs', library: { type: 'commonjs2' } },
  }, (error, stats) => {
    if (error) reject(error);
    else if (stats?.hasErrors()) reject(new Error(stats.toString()));
    else resolve();
  }));
  const { heicToJpeg } = require(path.join(root, 'server.cjs')) as typeof import('./heic');
  expect(await sharp(await heicToJpeg(HEIC_PHOTO)).metadata()).toMatchObject({ format: 'jpeg', width: 64, height: 48 });
}, 30_000);
