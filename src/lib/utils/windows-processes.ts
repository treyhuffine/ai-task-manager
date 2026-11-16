import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProcessIdentity } from '@/lib/worker/leftovers';
import { untraced } from './untraced';

const run = promisify(execFile);
function script(pids?: number[]) {
  const filter = pids?.length ? ` -Filter '${pids.map(pid => {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid process ID');
    return `ProcessId = ${pid}`;
  }).join(' OR ')}'` : '';
  return `@(Get-CimInstance Win32_Process${filter} | Select-Object @{n='pid';e={[int]$_.ProcessId}},@{n='ppid';e={[int]$_.ParentProcessId}},@{n='started';e={$_.CreationDate.ToUniversalTime().ToString('o')}},@{n='command';e={if ($_.CommandLine) {$_.CommandLine} else {$_.Name}}}) | ConvertTo-Json -Compress`;
}
const parse = (output: string): ProcessIdentity[] => {
  const rows = output.trim() ? JSON.parse(output) : [];
  return (Array.isArray(rows) ? rows : [rows]).map((row: ProcessIdentity) => ({ ...row, birthId: `${row.pid}:${row.started}` }));
};
export async function windowsProcesses(pids?: number[]): Promise<ProcessIdentity[]> {
  const { stdout } = await run(untraced('powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script(pids)],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return parse(stdout);
}
export function windowsProcessesSync(pids: number[]): ProcessIdentity[] {
  return parse(execFileSync(untraced('powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script(pids)],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 }));
}

/** Force a child and its descendants when graceful IPC shutdown times out. */
export async function terminateWindowsTree(pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid process ID');
  try { await run(untraced('taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { windowsHide: true }); }
  catch (error) { if (!['128', '255'].includes(String((error as { code?: unknown }).code))) throw error; }
}
