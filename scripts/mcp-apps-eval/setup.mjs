import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { here, root, projects, pidFile } from './config.mjs'

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`)
}

if (existsSync(pidFile)) throw new Error('Stop the evaluation before setting it up again.')
mkdirSync(root, { recursive: true })
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'))
for (const [name, source] of Object.entries(sources)) {
  const destination = join(root, 'upstream', name)
  if (!existsSync(join(destination, '.git'))) {
    mkdirSync(destination, { recursive: true })
    run('git', ['init', '--quiet'], destination)
    run('git', ['remote', 'add', 'origin', source.url], destination)
  }
  run('git', ['fetch', '--depth=1', 'origin', source.revision], destination)
  run('git', ['checkout', '--detach', source.revision], destination)
}
cpSync(join(root, 'upstream/extApps/examples/basic-host'), join(root, 'host'), { recursive: true })
cpSync(join(root, 'upstream/extApps/examples/scenario-modeler-server'), join(root, 'scenario'), { recursive: true })
cpSync(join(root, 'upstream/excalidraw'), join(root, 'excalidraw-source'), {
  recursive: true,
  filter: (path) => !path.endsWith('/.git'),
})
run('git', ['apply', '--check', join(here, 'evaluation.patch')])
run('git', ['apply', join(here, 'evaluation.patch')])
run('git', ['apply', '--check', join(here, 'ri-embed.patch')])
run('git', ['apply', join(here, 'ri-embed.patch')])
run('git', ['apply', '--check', join(here, 'conversation.patch')])
run('git', ['apply', join(here, 'conversation.patch')])
run('git', ['apply', '--check', join(here, 'third-party.patch')])
run('git', ['apply', join(here, 'third-party.patch')])
for (const project of projects) {
  cpSync(join(here, 'locks', project + '.yaml'), join(root, project, 'pnpm-lock.yaml'))
  run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], join(root, project))
  run('pnpm', ['build'], join(root, project))
}
writeFileSync(join(root, 'sources.json'), JSON.stringify(sources, null, 2) + '\n')
console.log(`Evaluation built in ${root}\nStart: node scripts/mcp-apps-eval/start.mjs\nKeep the same RI_MCP_APPS_EVAL_DIR override for every command if you set one.`)
