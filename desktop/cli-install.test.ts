import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { installTerminalCommand, removeTerminalCommand } from './cli-install';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
it('runs the bundled runtime with isolated paths and preserves literal shell arguments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ri-cli-'quote-")); dirs.push(dir);
  const cli = path.join(dir, 'cli.mjs');
  fs.writeFileSync(cli, 'console.log(JSON.stringify({root:process.env.RI_ROOT,db:process.env.RI_DB_PATH,args:process.argv.slice(2)}))');
  const options = { node: process.execPath, cli, root: path.join(dir, 'home'), server: dir };
  const command = path.join(dir, 'bin/ri-desktop');
  installTerminalCommand(command, options);
  installTerminalCommand(command, options);
  const result = JSON.parse(execFileSync(command, ['literal $(touch danger)'], { env: { ...process.env, RI_ROOT: '/real', RI_DB_PATH: '/real/data.db', RI_DESKTOP_ROOT: '' }, encoding: 'utf8' }));
  expect(result).toEqual({ root: options.root, args: ['literal $(touch danger)'] });
  removeTerminalCommand(command, options);
  expect(fs.existsSync(command)).toBe(false);
  fs.writeFileSync(command, 'existing CLI');
  expect(() => installTerminalCommand(command, options)).toThrow('already exists');
  expect(() => removeTerminalCommand(command, options)).toThrow('left unchanged');
  expect(fs.readFileSync(command, 'utf8')).toBe('existing CLI');
  const link = path.join(dir, 'other'); fs.symlinkSync(command, link);
  expect(() => installTerminalCommand(link, options)).toThrow('already exists');
});
