import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT_ENV, CONFIG_DIR_ENV, DB_PATH_ENV, WORK_DIR_ENV } from '../src/lib/config/paths';

export interface CliInstallation { node: string; cli: string; root: string; server: string }
export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function terminalCommand(options: CliInstallation) {
  return [
    '#!/bin/sh',
    '# Ri desktop terminal command. Remove through the matching desktop app.',
    `# ${JSON.stringify(options)}`,
    `if [ -n "\${RI_DESKTOP_ROOT:-}" ]; then export ${APP_ROOT_ENV}="$RI_DESKTOP_ROOT"; else export ${APP_ROOT_ENV}=${shellQuote(options.root)}; fi`,
    `unset ${DB_PATH_ENV} ${CONFIG_DIR_ENV} ${WORK_DIR_ENV} NODE_OPTIONS ELECTRON_RUN_AS_NODE`,
    `export RI_DESKTOP=1 NEXT_DIST_DIR=.next-desktop`,
    `export RI_DESKTOP_REPO=${shellQuote(options.server)}`,
    `cd ${shellQuote(options.server)} || exit 1`,
    `exec ${shellQuote(options.node)} ${shellQuote(options.cli)} "$@"`,
    '',
  ].join('\n');
}

/** Exclusive creation: never replace a CLI installed by Homebrew, pnpm, or another app. */
export function installTerminalCommand(target: string, options: CliInstallation) {
  const contents = terminalCommand(options);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try { fs.writeFileSync(target, contents, { flag: 'wx', mode: 0o755 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const stat = fs.lstatSync(target);
    if (!stat.isSymbolicLink() && stat.isFile() && fs.readFileSync(target, 'utf8') === contents) return;
    throw new Error(`A command already exists at ${target}. Choose a different name or location.`);
  }
}

export function removeTerminalCommand(target: string, options: CliInstallation) {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile() || fs.readFileSync(target, 'utf8') !== terminalCommand(options)) {
    throw new Error('This command belongs to a different installation and was left unchanged.');
  }
  fs.unlinkSync(target);
}
