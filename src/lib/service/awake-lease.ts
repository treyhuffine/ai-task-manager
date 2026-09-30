import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const AWAKE_LEASE_MS = 60_000;
export interface AwakeLease { alive(): boolean; stop(): Promise<void> }

// systemd-inhibit owns the kernel inhibitor FD while this utility runs. Its
// stdin is a private pipe from the controller: controller death closes it,
// exits this utility, and releases the inhibitor. The fixed deadline also
// bounds a stalled controller. Never execute renderer text or a shell here.
export const AWAKE_PIPE_GUARD = `
const timeout = Number(process.argv[1]);
if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000) process.exit(1);
process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', () => process.exit(1));
process.stdin.resume();
setTimeout(() => process.exit(0), timeout);
process.stdout.write('RI_AWAKE_READY\\n');
`;

export function awakeCommand(platform: NodeJS.Platform, pid: number, node = process.execPath) {
  // -s alone permits Dark Wake. -i explicitly prevents user-idle sleep so
  // ordinary app/CLI work stays available. Power polling releases -i on
  // battery, while the OS additionally gates -s to AC power immediately.
  if (platform === 'darwin') return { executable: '/usr/bin/caffeinate', args: ['-i', '-s', '-w', String(pid), '-t', String(AWAKE_LEASE_MS / 1000)] };
  if (platform === 'linux') return { executable: '/usr/bin/systemd-inhibit', args: [
    '--what=sleep', '--mode=block', '--who=Ri', '--why=Keep Ri available while on external power', '--no-ask-password',
    node, '-e', AWAKE_PIPE_GUARD, String(AWAKE_LEASE_MS),
  ] };
  throw new Error('Keep awake is available on macOS and Linux.');
}

export function macAwakeConfirmed(output: string, pid: number) {
  return ['PreventUserIdleSystemSleep', 'PreventSystemSleep'].every(type =>
    new RegExp(`pid ${pid}\\(caffeinate\\):[^\\n]*\\b${type}\\b`).test(output));
}

function live(child: ChildProcess) { return child.exitCode === null && child.signalCode === null; }

export async function startAwakeLease(platform: NodeJS.Platform): Promise<AwakeLease> {
  const command = awakeCommand(platform, process.pid);
  const child = spawn(command.executable, command.args, {
    detached: true, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    // In particular, do not inherit NODE_OPTIONS into the small pipe guard.
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', HOME: process.env.HOME, NODE_ENV: process.env.NODE_ENV },
  });
  let ended = false;
  let error: Error | undefined;
  let output = '';
  let failure = '';
  child.once('error', value => { error = value; ended = true; });
  child.once('exit', () => { ended = true; });
  child.stdin?.on('error', () => { /* teardown can race normal lease expiry */ });
  child.stdout?.on('data', chunk => { output = (output + String(chunk)).slice(-1024); });
  child.stderr?.on('data', chunk => { failure = (failure + String(chunk)).slice(-2048); });
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    child.stdin?.end();
    if (!child.pid || ended || !live(child)) return;
    const kill = (signal: NodeJS.Signals) => {
      try { process.kill(-child.pid!, signal); }
      catch (value) { if ((value as NodeJS.ErrnoException).code !== 'ESRCH') throw value; }
    };
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
    kill('SIGTERM');
    const forced = setTimeout(() => { try { kill('SIGKILL'); } catch { /* fixed lease is the last boundary */ } }, 1000);
    try { await closed; } finally { clearTimeout(forced); }
  })();
  try {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      if (ended || error || failure) throw new Error('The operating system could not keep this device awake.');
      if (platform === 'linux' && output.includes('RI_AWAKE_READY\n')) return { alive: () => !ended && live(child), stop };
      if (platform === 'darwin' && child.pid) {
        // A successful spawn is not evidence that IOKit granted an assertion.
        const { stdout } = await execute('/usr/bin/pmset', ['-g', 'assertions'], { timeout: 1000, maxBuffer: 256 * 1024, env: { ...process.env, LC_ALL: 'C' } });
        if (macAwakeConfirmed(stdout, child.pid) && !ended && !failure) {
          return { alive: () => !ended && live(child), stop };
        }
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('The operating system did not confirm a sleep inhibitor.');
  } catch {
    await stop();
    throw new Error(platform === 'linux'
      ? 'Sleep inhibition is unavailable. Linux needs systemd-logind and permission to inhibit sleep.'
      : 'macOS did not grant a sleep assertion.');
  }
}
