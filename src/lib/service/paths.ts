import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_NAME, APP_SHORT_ID } from '@/constants/app';
import { createHash } from 'node:crypto';
import { getAppRoot, getConfigDir, getDbPath, getWorkDir } from '@/lib/config/paths';

export function canonical(file: string): string {
  const absolute = path.resolve(file);
  if (fs.existsSync(absolute)) return fs.realpathSync(absolute);
  const parent = path.dirname(absolute);
  return parent === absolute ? absolute : path.join(canonical(parent), path.basename(absolute));
}

export function serviceIdentity() {
  return { root: canonical(getAppRoot()), database: canonical(getDbPath()), config: canonical(getConfigDir()), work: canonical(getWorkDir()) };
}

export function servicePaths() {
  const identity = serviceIdentity();
  const id = createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24);
  return {
    id, identity,
    // A short per-user socket path also works with macOS's sockaddr_un limit.
    socket: path.join(os.tmpdir(), `ri-${process.getuid?.() ?? 'user'}-${id}.sock`),
    settings: path.join(identity.config, 'local-service.json'),
    log: path.join(identity.work, 'service.log'),
    ownerLock: `${identity.database}.owner.sqlite`,
  };
}

export function getRuntimeInstallDir() {
  const base = process.env.RI_INSTALL_ROOT || (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library/Application Support', APP_NAME, 'runtime')
    : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), APP_SHORT_ID, 'runtime'));
  return canonical(path.resolve(base, servicePaths().id));
}
