/**
 * Default {@link NativeRunner}: real command execution with fixed argument
 * arrays. Never interpolates untrusted values into a shell string.
 */

import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import type { NativeRunner, RunResult } from './types';

export function createNativeRunner(): NativeRunner {
  return {
    platform: process.platform,
    env: process.env,
    homedir: os.homedir(),

    which(command: string): string | null {
      const probe = process.platform === 'win32' ? 'where' : 'command';
      const args = process.platform === 'win32' ? [command] : ['-v', command];
      const res = spawnSync(probe, args, {
        encoding: 'utf8',
        shell: process.platform !== 'win32',
      });
      if (res.status !== 0) return null;
      const line = (res.stdout || '').split(/\r?\n/).find(Boolean);
      return line ? line.trim() : null;
    },

    exists(p: string): boolean {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    },

    readFile(p: string): string | null {
      try {
        return fs.readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    },

    writeFile(p: string, data: string): { ok: boolean; error?: string } {
      try {
        fs.writeFileSync(p, data);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as NodeJS.ErrnoException).code ?? (err as Error).message };
      }
    },

    removeFile(p: string): { ok: boolean; error?: string } {
      try {
        fs.rmSync(p, { force: true });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as NodeJS.ErrnoException).code ?? (err as Error).message };
      }
    },

    run(command: string, args: string[], opts: { input?: string } = {}): RunResult {
      const res = spawnSync(command, args, {
        encoding: 'utf8',
        input: opts.input,
      });
      if (res.error) {
        return { status: null, stdout: '', stderr: '', error: res.error.message };
      }
      return {
        status: res.status,
        stdout: res.stdout ?? '',
        stderr: res.stderr ?? '',
      };
    },
  };
}
