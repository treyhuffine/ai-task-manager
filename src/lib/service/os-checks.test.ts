import os from 'node:os';
import { expect, it } from 'vitest';
import { commandCheck, diskCheck, linuxChecks, macChecks, type Run } from './os-checks';

const GiB = 1024 ** 3;
const outputs = (map: Record<string, string | null>): Run => (command, args) => map[`${command} ${args.join(' ')}`] ?? null;
const PMSET = ' System-wide power settings:\nCurrently in use:\n standby              0\n autorestart          1\n sleep                0\n disksleep            10\n';

it("finds a Mac that comes back on its own: the owner's Mini", () => {
  const checks = macChecks(outputs({
    '/usr/bin/defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser': 'agent\n',
    '/usr/bin/fdesetup status': 'FileVault is Off.\n',
    '/usr/bin/pmset -g': PMSET,
  }), 'agent');
  expect(checks.filter(check => check.warn)).toEqual([]);
  expect(checks.map(check => check.name)).toEqual(['Automatic login', 'FileVault', 'Restart after power failure', 'Sleep']);
});

it('says what keeps a Mac from coming back, and the fix', () => {
  const checks = macChecks(outputs({
    '/usr/bin/fdesetup status': 'FileVault is On.\n',
    '/usr/bin/pmset -g': PMSET.replace('autorestart          1', 'autorestart          0').replace('sleep                0', 'sleep                10'),
  }), 'trey');
  expect(checks.every(check => check.ok && check.warn)).toBe(true);
  expect(checks.map(check => check.detail)).toEqual([
    'off. After a restart or power cut, Ri waits until trey logs in. Turn it on in System Settings > Users & Groups for a Mac nobody sits at',
    'on. After an unplanned restart nothing starts until someone unlocks the disk. For a planned restart: sudo fdesetup authrestart',
    'off, so the Mac stays off after a power cut. To turn it on: sudo pmset -a autorestart 1',
    'after 10 min idle, which pauses Ri. To keep the Mac awake on power: ri service awake on',
  ]);
});

it('gives the linger command on Linux', () => {
  expect(linuxChecks(outputs({ 'loginctl show-user maya --property=Linger': 'Linger=no\n' }), 'maya')[0])
    .toMatchObject({ warn: true, detail: 'off, so Ri starts only once maya logs in. To start it at boot: sudo loginctl enable-linger maya' });
  expect(linuxChecks(outputs({ 'loginctl show-user maya --property=Linger': 'Linger=yes\n' }), 'maya')[0]).toMatchObject({ ok: true, detail: 'on for maya' });
});

it('warns under the larger of 20 GiB or the database, and fails near empty', () => {
  expect(diskCheck(40 * GiB, 21 * GiB)).toMatchObject({ ok: true, detail: '40.0 GiB free' });
  expect(diskCheck(15 * GiB, 21 * GiB)).toMatchObject({ ok: true, warn: true, detail: expect.stringContaining('under 21.0 GiB') });
  expect(diskCheck(1 * GiB, 1 * GiB)).toMatchObject({ ok: false });
});

it("names whatever hides the launcher, Ruby's ri included", () => {
  const launcher = `${os.homedir()}/.local/bin/ri`;
  expect(commandCheck(launcher, launcher, true)).toMatchObject({ ok: true, detail: '~/.local/bin/ri' });
  expect(commandCheck('/usr/bin/ri', launcher, true).detail).toBe("/usr/bin/ri, Ruby's documentation tool, comes first. Put ~/.local/bin before /usr/bin in your shell's PATH");
  expect(commandCheck(`${os.homedir()}/Library/pnpm/bin/ri`, launcher, true).detail).toContain('Library/pnpm/bin/ri runs instead of ~/.local/bin/ri');
  expect(commandCheck(null, launcher, false).detail).toBe('not installed. `ri update` installs it at ~/.local/bin/ri');
});
