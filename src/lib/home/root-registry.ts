/** Per-OS-user location metadata only. No Home databases or credentials are opened. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { APP_SHORT_ID } from '@/constants/app';
import { getAppRoot, getWorkDir } from '@/lib/config/paths';
import { atomicWriteFile } from '@/lib/config/atomic-write';
import type { HomeKind } from '@/db/types';

export function homeRegistryDir() {
  return process.env.RI_HOME_REGISTRY_DIR ?? (process.env.VITEST ? path.join(/* turbopackIgnore: true */ getWorkDir(), 'home-registry') : path.join(/* turbopackIgnore: true */ os.homedir(), '.config', APP_SHORT_ID, 'home-roots'));
}
export function registerHomeRoot(kind: HomeKind, root = getAppRoot(), directory = homeRegistryDir()) {
  try {
    const canonical = fs.realpathSync(root);
    const name = createHash('sha256').update(canonical).digest('hex') + '.json';
    const file = path.join(/* turbopackIgnore: true */ directory, name), contents = JSON.stringify({ root: canonical, kind }) + '\n';
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === contents) return;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    atomicWriteFile(file, contents);
  } catch { /* A warning registry must never block a Home from starting. */ }
}
export function registeredPersonalRoots(directory = homeRegistryDir()): string[] {
  const roots: string[] = [];
  try {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
      try {
        const record = JSON.parse(fs.readFileSync(path.join(/* turbopackIgnore: true */ directory, entry.name), 'utf8'));
        if (record.kind === 'personal' && typeof record.root === 'string' && path.isAbsolute(record.root)) roots.push(record.root);
      } catch { /* Invalid registry metadata cannot grant any authority. */ }
    }
  } catch { /* No Homes have registered yet. */ }
  return roots;
}
