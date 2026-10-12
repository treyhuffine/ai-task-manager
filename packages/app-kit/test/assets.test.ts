import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const expected = path.join(path.dirname(require.resolve('@ri/app-kit/build')), 'owned-runner.cjs');

it('resolves runtime assets when a server bundle supplies a virtual module URL', async () => {
  const temporary = await fs.mkdtemp(path.join(root, 'node_modules/.ri-kit-assets-'));
  try {
    const output = path.join(temporary, 'probe.cjs');
    await build({
      stdin: {
        contents: `import {kitAsset} from './src/assets.ts'; import {appKitToolchain} from './src/build.ts'; process.stdout.write(JSON.stringify({runner:kitAsset('owned-runner.cjs'),tools:appKitToolchain()}));`,
        resolveDir: root,
      },
      outfile: output, bundle: true, platform: 'node', format: 'cjs', packages: 'external',
      define: { 'import.meta.url': JSON.stringify('file:///ROOT/packages/app-kit/dist/assets.cjs') },
    });
    const { stdout } = await exec(process.execPath, [output], { cwd: root, timeout: 5000 });
    const result = JSON.parse(stdout);
    expect(result.runner).toBe(expected);
    expect((await fs.stat(result.runner)).isFile()).toBe(true);
    expect(result.tools.packageDir).toBe(path.dirname(path.dirname(expected)));
    expect((await fs.stat(result.tools.pnpm)).isFile()).toBe(true);
    expect((await fs.stat(result.tools.validationWorker)).isFile()).toBe(true);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

it('keeps native module resolution when a consumer changes its working directory', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ri-kit-assets-cwd-'));
  try {
    const source = path.join(path.dirname(expected), 'assets.cjs');
    const { stdout } = await exec(process.execPath, ['-e',
      `process.chdir(${JSON.stringify(temporary)}); process.stdout.write(require(${JSON.stringify(source)}).kitAsset('owned-runner.cjs'));`,
    ], { timeout: 5000 });
    expect(stdout).toBe(expected);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
