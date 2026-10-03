import { tmpdir } from 'node:os'
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const here = dirname(fileURLToPath(import.meta.url))
function physicalPath(path) {
  if (existsSync(path)) return realpathSync(path)
  const parent = dirname(path)
  return parent === path ? path : join(physicalPath(parent), basename(path))
}
export const checkout = physicalPath(resolve(here, '../..'))
export const root = physicalPath(resolve(process.env.RI_MCP_APPS_EVAL_DIR || join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'ri-mcp-apps-0a')))
if (root === checkout || root.startsWith(checkout + sep)) {
  throw new Error('The evaluation must live outside Ri’s dependency tree. Choose a separate temporary folder.')
}
export const url = 'http://ri-mcp-apps.127.0.0.1.nip.io:48880'
export const projects = ['host', 'scenario', 'excalidraw-source']
export const pidFile = join(root, 'running.json')

// Server children receive no subscription keys, Ri credentials or Home settings.
export function serverEnv() {
  return Object.fromEntries(Object.entries({ PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, NODE_ENV: 'production' }).filter(([, value]) => value !== undefined))
}
