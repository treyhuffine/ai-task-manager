import path from 'node:path';
import { APP_SHORT_ID } from '../src/constants/app';
import { APP_ROOT_ENV, DB_PATH_ENV, CONFIG_DIR_ENV, WORK_DIR_ENV } from '../src/lib/config/paths';

/** A demo cannot silently inherit the real app's data or advanced path overrides. */
export function demoEnvironment(repo: string, original: NodeJS.ProcessEnv, mode: 'development' | 'production') {
  const root = path.resolve(original.RI_DESKTOP_ROOT || path.join(original.RI_DESKTOP_STATE_DIR || path.join(repo, '.electron-demo'), 'home'));
  const env = { ...original };
  // Empty overrides use the path helpers' root-relative defaults and prevent
  // Next's .env loader from filling them back in with a real data path.
  for (const [name, desktopName] of [[DB_PATH_ENV, 'RI_DESKTOP_DATABASE'], [CONFIG_DIR_ENV, 'RI_DESKTOP_CONFIG'], [WORK_DIR_ENV, 'RI_DESKTOP_WORK']]) {
    env[name] = original.RI_DESKTOP_ASSOCIATED === '1' && original[desktopName] ? path.resolve(original[desktopName]!) : '';
  }
  for (const name of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']) delete env[name];
  env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
  env[APP_ROOT_ENV] = root;
  env.RI_DESKTOP_ROOT = root;
  env.RI_DESKTOP = '1';
  env.RI_DESKTOP_REPO = repo;
  env.RI_DESKTOP_MODE = mode;
  env.NEXT_DIST_DIR = mode === 'development' ? '.next-desktop-dev' : '.next-desktop';
  return env;
}

/** Existing harness CLI instructions use POSIX command strings. macOS demo first. */
export function bundledCliCommand(node: string, repo: string, root: string, locations?: { database: string; config: string; work: string }) {
  const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
  return `RI_DESKTOP=1 RI_DESKTOP_REPO=${quote(repo)} ${DB_PATH_ENV}=${quote(locations?.database ?? '')} ${CONFIG_DIR_ENV}=${quote(locations?.config ?? '')} ${WORK_DIR_ENV}=${quote(locations?.work ?? '')} ${APP_SHORT_ID.toUpperCase()}_ROOT=${quote(root)} ${quote(node)} ${quote(path.join(repo, 'dist/cli/index.mjs'))}`;
}

export interface BackendReady {
  type: 'ready';
  connection?: 'home' | 'remote';
  homeId?: string;
  homeName?: string;
  deviceId?: string | null;
  serviceRunId?: string;
  desktopClient?: string;
  runtime?: { repo: string; node: string; launcher?: string };
  origin: string;
  certificate: string;
  token: string;
}

export type BackendMessage = BackendReady | { type: 'setup'; status: import('./connection-setup').ConnectionSetupStatus } | { type: 'status'; status: import('../src/lib/service/client').ServiceStatus } | { type: 'certificate'; origin: string; certificate: string } | { type: 'error'; message: string };
