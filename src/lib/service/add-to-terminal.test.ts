import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { addToTerminal, shellProfile } from './add-to-terminal';

const mocks = vi.hoisted(() => ({ install: vi.fn() }));
vi.mock('./runtime', () => ({ installCommandLauncher: mocks.install, commandLauncherPath: () => '/nowhere/ri' }));
let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-terminal-'));
  mocks.install.mockReturnValue({ file: path.join(home, '.local/bin/ri'), installed: true });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

it('picks the file each shell reads at login', () => {
  expect(shellProfile('/bin/zsh', 'darwin', '/h').file).toBe('/h/.zprofile');
  expect(shellProfile('/bin/bash', 'darwin', '/h').file).toBe('/h/.bash_profile');
  expect(shellProfile('/bin/bash', 'linux', '/h').file).toBe('/h/.profile');
  expect(shellProfile(undefined, 'darwin', '/h').file).toBe('/h/.zprofile');
  expect(shellProfile('/usr/bin/fish', 'linux', '/h').line('$HOME/.local/bin')).toBe('fish_add_path -p $HOME/.local/bin');
});

it('adds the folder ahead of /usr/bin once, and says what it changed', () => {
  const first = addToTerminal({ HOME: home, SHELL: '/bin/zsh' }, 'darwin');
  expect(first.changed).toEqual(['~/.local/bin/ri', '~/.zprofile']);
  expect(first.message).toContain('Open a new terminal window');
  const written = fs.readFileSync(path.join(home, '.zprofile'), 'utf8');
  expect(written).toContain('export PATH="$HOME/.local/bin:$PATH"');
  const second = addToTerminal({ HOME: home, SHELL: '/bin/zsh' }, 'darwin');
  expect(second.changed).toEqual(['~/.local/bin/ri']);
  expect(second.message).toContain('already has');
  expect(fs.readFileSync(path.join(home, '.zprofile'), 'utf8')).toBe(written);
});

it('keeps what the profile already says', () => {
  fs.writeFileSync(path.join(home, '.zprofile'), 'export EDITOR=vim');
  addToTerminal({ HOME: home, SHELL: '/bin/zsh' }, 'darwin');
  const written = fs.readFileSync(path.join(home, '.zprofile'), 'utf8');
  expect(written.startsWith('export EDITOR=vim\n')).toBe(true);
  expect(written).toContain('# Added by Ri');
});

it('changes nothing when another program already sits at that path', () => {
  mocks.install.mockReturnValue({ file: path.join(home, '.local/bin/ri'), installed: false, reason: 'Another program is already there.' });
  const result = addToTerminal({ HOME: home, SHELL: '/bin/zsh' }, 'darwin');
  expect(result).toEqual({ installed: false, changed: [], message: 'Another program is already there.' });
  expect(fs.existsSync(path.join(home, '.zprofile'))).toBe(false);
});
