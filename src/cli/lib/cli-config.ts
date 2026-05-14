/**
 * Laptop-local CLI preferences. Separate from the per-origin browser
 * localStorage prefs because:
 *
 *  - The browser preference is per-origin (one setting per Flow
 *    instance the user connects to).
 *  - The CLI preference is per-machine (which editor on THIS laptop).
 *
 * Persisted as a tiny JSON file under the app root so it survives
 * shell restarts. The CLI is the only writer, the only reader.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ensureAppRoot, getAppRoot } from '@/lib/config/paths';

export type CliEditor = 'cursor' | 'vscode' | 'jetbrains';

export interface CliConfig {
  editor: CliEditor;
}

const DEFAULT_CONFIG: CliConfig = { editor: 'cursor' };

function getConfigPath(): string {
  return path.join(getAppRoot(), 'cli-config.json');
}

export function readCliConfig(): CliConfig {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<CliConfig>;
    return {
      editor:
        parsed.editor === 'cursor' || parsed.editor === 'vscode' || parsed.editor === 'jetbrains'
          ? parsed.editor
          : DEFAULT_CONFIG.editor,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function writeCliConfig(input: Partial<CliConfig>): CliConfig {
  ensureAppRoot();
  const current = readCliConfig();
  const next: CliConfig = { ...current, ...input };
  fs.writeFileSync(getConfigPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}
