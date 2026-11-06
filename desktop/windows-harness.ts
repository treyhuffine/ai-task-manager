import { execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type WindowsHarnessRequest = { harness: 'claude' | 'codex'; action: 'install' | 'login' };

/** Fixed setup commands. No shell or arbitrary command from a page reaches
 * the OS. npm and Node ship with the native Windows installer. */
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
      const native = path.join(os.homedir(), '.local/bin', `${request.harness}.exe`);
      if (fs.existsSync(native)) { command = native; args = []; }
      else args = [path.join(prefix, 'node_modules', packageName, request.harness === 'codex' ? 'bin/codex.js' : 'cli.js')];
      args.push(...(request.harness === 'codex' ? ['login'] : ['auth', 'login']));
    }
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: [path.dirname(this.node), prefix, process.env.PATH ?? process.env.Path ?? ''].join(path.delimiter) };
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
