import path from 'node:path';
import { APP_SHORT_ID } from '../src/constants/app';
import { APP_ROOT_ENV, DB_PATH_ENV, CONFIG_DIR_ENV, WORK_DIR_ENV } from '../src/lib/config/paths';

/** A demo cannot silently inherit the real app's data or advanced path overrides. */
export function demoEnvironment(repo: string, original: NodeJS.ProcessEnv, mode: 'development' | 'production') {
  const root = path.resolve(original.RI_DESKTOP_ROOT || path.join(repo, '.electron-demo', 'home'));
  const env = { ...original };
  // Empty overrides use the path helpers' root-relative defaults and prevent
  // Next's .env loader from filling them back in with a real data path.
  for (const name of [DB_PATH_ENV, CONFIG_DIR_ENV, WORK_DIR_ENV]) env[name] = '';
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
export function bundledCliCommand(node: string, repo: string, root: string) {
  const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
  return `RI_DESKTOP=1 RI_DESKTOP_REPO=${quote(repo)} ${DB_PATH_ENV}='' ${CONFIG_DIR_ENV}='' ${WORK_DIR_ENV}='' ${APP_SHORT_ID.toUpperCase()}_ROOT=${quote(root)} ${quote(node)} ${quote(path.join(repo, 'dist/cli/index.mjs'))}`;
}

export interface BackendReady {
  type: 'ready';
  origin: string;
  certificate: string;
  token: string;
}

export type BackendMessage = BackendReady | { type: 'error'; message: string };
