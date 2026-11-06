/** Find a browser opened on Ri's profile outside Ri, without a pidfile. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Match the browser itself and the exact profile, never a helper or another home. */
export function usesBrowserProfile(command: string, executablePath: string, profileDir: string): boolean {
  // ps prints an unquoted executable on macOS. A browser's profile flags come
  // immediately after it, while a helper's longer executable name does not.
  const prefix = [`${executablePath} `, `"${executablePath}" `].find(value => command.startsWith(value));
  if (!prefix || !/^["']?--/.test(command.slice(prefix.length))) return false;
  if (/(?:^|\s)--type(?:=|\s)/.test(command)) return false;
  const escaped = profileDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)(?:--user-data-dir=(?:"${escaped}"|'${escaped}'|${escaped})|"--user-data-dir=${escaped}"|--user-data-dir\\s+(?:"${escaped}"|'${escaped}'|${escaped}))(?=\\s|$)`).test(command);
}

/** Only used during recovery, never on the normal connect-to-open-browser path. */
export async function findProfileBrowserPids(executablePath: string, profileDir: string): Promise<number[]> {
  // Windows recovery retains the pidfile backstop. Chromium manages its native
  // profile lock there, so Ri does not remove a live POSIX singleton lock.
  if (process.platform === 'win32') return [];
  const { stdout } = await run('ps', ['-ww', '-axo', 'pid=,command='], {
    timeout: 3_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    return match && usesBrowserProfile(match[2], executablePath, profileDir) ? [Number(match[1])] : [];
  });
}

/** Recheck immediately before a signal, since a pidfile can outlive its process. */
export async function isProfileBrowserPid(pid: number, executablePath: string, profileDir: string): Promise<boolean> {
  if (process.platform === 'win32') return true; // the existing pidfile backstop
  try {
    const { stdout } = await run('ps', ['-ww', '-p', String(pid), '-o', 'command='], { timeout: 3_000 });
    return usesBrowserProfile(stdout.trim(), executablePath, profileDir);
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false; // exited
    throw error;
  }
}
