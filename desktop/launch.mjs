import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import electron from 'electron';

const repo = fileURLToPath(new URL('../', import.meta.url));
const dev = process.argv.includes('--dev');
const root = path.resolve(process.env.RI_DESKTOP_ROOT || path.join(repo, '.electron-demo', 'home'));
const env = { ...process.env, RI_DESKTOP_REPO: repo, RI_DESKTOP_ROOT: root, RI_DESKTOP_NODE: process.execPath,
  RI_DESKTOP_MODE: dev ? 'development' : 'production' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;

function run(executable, args, childEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: repo, env: childEnv, stdio: 'inherit' });
    const stop = () => child.kill('SIGTERM');
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    child.once('error', reject);
    child.once('exit', (code) => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      if (code === 0) resolve();
      else reject(new Error(`Process exited with status ${code ?? 'signal'}.`));
    });
  });
}

try {
  if (!dev && !process.argv.includes('--skip-build')) {
    console.info('Building the production app for the Electron demo…');
    const buildEnv = { ...env, RI_ROOT: root, NEXT_DIST_DIR: '.next-desktop', NODE_ENV: 'production' };
    for (const name of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR']) buildEnv[name] = '';
    await run(process.execPath, [path.join(repo, 'node_modules/next/dist/bin/next'), 'build'], buildEnv);
  }
  if (!dev && !fs.existsSync(path.join(repo, '.next-desktop/BUILD_ID'))) {
    throw new Error('Run pnpm desktop:demo once to build the production app, or use pnpm desktop:dev.');
  }
  if (!process.argv.includes('--build-only')) {
    await run(electron, [path.join(repo, 'dist/desktop/main.cjs')], env);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
