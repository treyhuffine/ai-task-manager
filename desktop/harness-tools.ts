import { execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type HarnessToolRequest = { harness: 'claude' | 'codex'; action: 'install' | 'login' };

const PACKAGES = { claude: '@anthropic-ai/claude-code', codex: '@openai/codex' } as const;
const SIGN_IN = { claude: ['auth', 'login'], codex: ['login'] } as const;

/** What the Install and Sign in buttons run on a Mac or Linux computer. A page can
 * pick only these two tools and actions, and never supplies command text. npm ships
 * with the release's Node, so someone with no developer tools can still install. */
export function harnessToolCommand(request: HarnessToolRequest, node: string, home: string) {
  const prefix = path.join(home, '.local');
  const env = { PATH: [path.join(prefix, 'bin'), path.dirname(node), process.env.PATH ?? ''].join(path.delimiter) };
  if (request.action === 'login') return { command: request.harness, args: [...SIGN_IN[request.harness]], env };
  const npm = path.resolve(path.dirname(node), '../lib/node_modules/npm/bin/npm-cli.js');
  return { command: node, args: [npm, 'install', '--global', '--prefix', prefix, PACKAGES[request.harness]], env };
}

export function parseHarnessToolRequest(value: unknown): HarnessToolRequest {
  const request = value as Partial<HarnessToolRequest> | null;
  if (!request || (request.harness !== 'claude' && request.harness !== 'codex') || (request.action !== 'install' && request.action !== 'login')) throw new Error('Choose Claude Code or Codex to install or sign in to.');
  return { harness: request.harness, action: request.action };
}

export class HarnessToolSetup {
  private child: ChildProcess | undefined;
  constructor(private node: string) {}

  async run(value: unknown): Promise<void> {
    const request = parseHarnessToolRequest(value);
    if (this.child) throw new Error('Finish the current setup first.');
    const { command, args, env } = harnessToolCommand(request, this.node, os.homedir());
    if (request.action === 'install' && !fs.existsSync(args[0])) throw new Error('This copy of Ri has no npm to install with. Install the tool from a terminal.');
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => this.stop(), 5 * 60_000);
      this.child = execFile(command, args, { env: { ...process.env, ...env }, maxBuffer: 4 * 1024 * 1024 }, error => {
        clearTimeout(timeout);
        this.child = undefined;
        if (error) reject(new Error(request.action === 'install' ? 'Installation did not finish. Check your internet connection and try again.' : 'Sign-in did not finish. Try again.'));
        else resolve();
      });
    });
  }
  stop() { this.child?.kill('SIGTERM'); }
}
