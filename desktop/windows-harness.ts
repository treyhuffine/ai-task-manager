import { execFile, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

export type WindowsHarnessRequest = { harness: 'claude' | 'codex'; action: 'install' | 'login' };

/** Fixed setup commands. A page can select only these two tools and actions.
 * npm and Node ship with the native Windows installer. */
export class WindowsHarnessSetup {
  private child: ChildProcess | undefined;
  constructor(private node: string) {}

  async run(value: unknown): Promise<void> {
    if (process.platform !== 'win32') throw new Error('Use the Windows desktop app for this setup.');
    const request = value as Partial<WindowsHarnessRequest> | null;
    if (!request || !['claude', 'codex'].includes(request.harness ?? '') || !['install', 'login'].includes(request.action ?? '')) throw new Error('Choose Claude Code or Codex setup.');
    if (this.child) throw new Error('Finish the current setup first.');
    const prefix = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData/Roaming'), 'npm');
    const packageName = request.harness === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code';
    let command = this.node;
    let args: string[];
    if (request.action === 'install') {
      args = [path.join(path.dirname(this.node), 'node_modules/npm/bin/npm-cli.js'), 'install', '--global', '--prefix', prefix, packageName];
    } else {
      // Normal command discovery supports npm shims, native installs and
      // WinGet. All command text is fixed, never supplied by the page.
      command = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/cmd.exe');
      args = ['/d', '/s', '/c', request.harness === 'codex' ? 'codex login' : 'claude auth login'];
    }
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: [path.dirname(this.node), prefix, path.join(os.homedir(), '.local/bin'), process.env.PATH ?? process.env.Path ?? ''].join(path.delimiter) };
    delete env.Path;
    await new Promise<void>((resolve, reject) => {
      this.child = execFile(command, args, { env, windowsHide: true, timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024 }, error => {
        this.child = undefined;
        if (error) reject(new Error(request.action === 'install' ? 'Installation did not finish. Check your internet connection and try again.' : 'Sign-in did not finish. Try again and complete the steps in your browser.'));
        else resolve();
      });
    });
  }
  stop() {
    if (this.child?.pid) execFile('taskkill.exe', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true });
  }
}
