import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { AWAKE_PIPE_GUARD, awakeCommand, macAwakeConfirmed } from './awake-lease';

it('uses bounded macOS idle and AC-only system assertions tied to the controller PID', () => {
  expect(awakeCommand('darwin', 12345)).toEqual({ executable: '/usr/bin/caffeinate', args: ['-i', '-s', '-w', '12345', '-t', '60'] });
});
it('requires both macOS assertions from the exact helper before claiming availability', () => {
  const idle = 'pid 12345(caffeinate): [0x01] 00:00:00 PreventUserIdleSystemSleep named: "caffeinate command-line tool"';
  const system = 'pid 12345(caffeinate): [0x02] 00:00:00 PreventSystemSleep named: "caffeinate command-line tool"';
  expect(macAwakeConfirmed(`${idle}\n${system}`, 12345)).toBe(true);
  expect(macAwakeConfirmed(idle, 12345)).toBe(false);
  expect(macAwakeConfirmed(system, 12345)).toBe(false);
  expect(macAwakeConfirmed(`${idle}\n${system}`, 1234)).toBe(false);
  expect(macAwakeConfirmed(`${idle}\n${system.replace('12345', '999')}`, 12345)).toBe(false);
});
it('uses Linux sleep inhibition without blocking display idle, shutdown, or asking for elevation', () => {
  const command = awakeCommand('linux', 12345, '/a path/node');
  expect(command.executable).toBe('/usr/bin/systemd-inhibit');
  expect(command.args).toContain('--what=sleep');
  expect(command.args).toContain('--no-ask-password');
  expect(command.args.slice(-4)).toEqual(['/a path/node', '-e', AWAKE_PIPE_GUARD, '60000']);
  expect(command.args.join(' ')).not.toContain('shutdown');
  expect(() => awakeCommand('win32', 12345)).toThrow('macOS and Linux');
});
it('the harmless pipe guard exits when its controller pipe disappears', async () => {
  // Executes only our tiny Node guard, never caffeinate or systemd-inhibit.
  const child = spawn(process.execPath, ['-e', AWAKE_PIPE_GUARD, '60000'], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const exit = once(child, 'exit');
    await once(child.stdout, 'data');
    child.stdin.destroy();
    expect(await exit).toEqual([0, null]);
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});
it('the harmless pipe guard bounds a stalled controller even with its pipe open', async () => {
  const child = spawn(process.execPath, ['-e', AWAKE_PIPE_GUARD, '100'], { stdio: ['pipe', 'pipe', 'pipe'] });
  try { expect(await once(child, 'exit')).toEqual([0, null]); }
  finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});
