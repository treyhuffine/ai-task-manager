import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertCompanionPackage, assertShellDependencies, rebaseResourceLinks } from './package-files.mjs';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
it('preserves pnpm links after the staging folder is removed and refuses external dependencies', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-package-links-')); dirs.push(temp);
  const source = path.join(temp, 'stage'); const output = path.join(temp, 'Resources');
  fs.mkdirSync(path.join(source, 'server/node_modules/.pnpm/dep'), { recursive: true });
  fs.writeFileSync(path.join(source, 'server/node_modules/.pnpm/dep/index.js'), 'portable');
  fs.symlinkSync('.pnpm/dep', path.join(source, 'server/node_modules/dep'));
  fs.cpSync(source, output, { recursive: true });
  expect(rebaseResourceLinks(output, source)).toBe(1);
  fs.rmSync(source, { recursive: true });
  expect(fs.readFileSync(path.join(output, 'server/node_modules/dep/index.js'), 'utf8')).toBe('portable');
  fs.mkdirSync(source);
  fs.symlinkSync(temp, path.join(output, 'outside'));
  expect(() => rebaseResourceLinks(output, source)).toThrow('escapes resources');
});

it('refuses a new companion package missing setup, worker, privileged preload or offline appearance assets', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-package-companion-')); dirs.push(temporary);
  const server = path.join(temporary, 'server'); const shell = path.join(temporary, 'shell');
  const assets = ['src/styles/theme.css', 'public/fonts/inter-latin.woff2', 'public/fonts/OFL.txt', 'public/brand/ri-mark-white.svg'].map(file => path.join(server, file));
  const files = [path.join(server, 'dist/desktop/connection-setup-entry.cjs'), path.join(server, 'dist/service/worker.cjs'), path.join(shell, 'companion-preload.cjs'), path.join(shell, 'local-preload.cjs'), ...assets];
  for (const file of files) {
    expect(() => assertCompanionPackage(server, shell)).toThrow(/missing or unsafe/);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'built');
  }
  expect(() => assertCompanionPackage(server, shell)).not.toThrow();
  for (const file of [files[2], ...assets]) {
    fs.unlinkSync(file);
    expect(() => assertCompanionPackage(server, shell)).toThrow(file);
    fs.symlinkSync(files[0], file);
    expect(() => assertCompanionPackage(server, shell)).toThrow(file);
    fs.unlinkSync(file); fs.mkdirSync(file);
    expect(() => assertCompanionPackage(server, shell)).toThrow(file);
    fs.rmdirSync(file); fs.writeFileSync(file, 'built');
  }
  expect(() => assertCompanionPackage(server, shell)).not.toThrow();
});

function shellFixture(files: Record<string, string>) {
  const shell = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-shell-boundary-')); dirs.push(shell);
  for (const [name, source] of Object.entries(files)) {
    const file = path.join(shell, name);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source);
  }
  return shell;
}

it('checks every shell bundle and permits only Electron and actual Node builtins', () => {
  const shell = shellFixture({
    'main.cjs': `const electron = require('electron'); require('node:fs'); require('path');
      // require('better-sqlite3') is only an explanatory comment.
      const message = "require('missing-package')";`,
    'preload.cjs': `require /* multiline */ (
 'electron'
);`,
    'nested/helper.mjs': `import fs from 'node:fs'; export { join } from 'path';`,
    'companion-preload.js': `import('electron'); module.require('node:os'); require.resolve('node:crypto');`,
  });
  expect(assertShellDependencies(shell)).toBe(4);
});

it.each([
  `require('better-sqlite3')`,
  `require /* native binding */ (
 'better-sqlite3'
)`,
  String.raw`require('better-\x73qlite3')`,
  `__require('sqlite-vec')`,
  `module['require']('node-pty')`,
  `require.resolve('better-sqlite3')`,
  `import('../server/database.js')`,
  `import sqlite from 'better-sqlite3'`,
  `export { default } from 'better-sqlite3'`,
  `require('node:not-a-builtin')`,
])('rejects application dependencies even inside a deferred preload: %s', (dependency) => {
  const shell = shellFixture({ 'main.cjs': `require('electron')`, 'companion-preload.cjs': `function deferred() { ${dependency.startsWith('import sqlite') || dependency.startsWith('export ') ? '' : dependency} }
${dependency.startsWith('import sqlite') || dependency.startsWith('export ') ? dependency : ''}` });
  expect(() => assertShellDependencies(shell)).toThrow(/companion-preload.cjs:.*loads external module/);
});

it.each([
  `require(process.env.MODULE)`,
  `import('./' + name)`,
  `require('better-' + 'sqlite3')`,
  `const loader = createRequire(__filename); loader('better-sqlite3')`,
  `require('node:module').createRequire(__filename)('better-sqlite3')`,
])('fails closed on a loader whose target cannot be checked: %s', (source) => {
  expect(() => assertShellDependencies(shellFixture({ 'main.cjs': source }))).toThrow(/module loader/);
});

it('refuses malformed, empty or symlinked shell bundles', () => {
  expect(() => assertShellDependencies(shellFixture({ 'main.cjs': 'require(' }))).toThrow(/invalid JavaScript/);
  expect(() => assertShellDependencies(shellFixture({}))).toThrow(/no shell bundles/);
  const shell = shellFixture({ 'main.cjs': `require('electron')` });
  fs.symlinkSync(path.join(shell, 'main.cjs'), path.join(shell, 'preload.cjs'));
  expect(() => assertShellDependencies(shell)).toThrow(/unsafe symlink/);
});
