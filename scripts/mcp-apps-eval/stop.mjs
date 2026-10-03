import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { here, root, pidFile } from './config.mjs'

if (!existsSync(pidFile)) {
  console.log('The evaluation is stopped.')
  process.exit(0)
}
const state = JSON.parse(readFileSync(pidFile, 'utf8'))
if (state.root !== root || state.script !== join(here, 'start.mjs') || !Number.isInteger(state.pid) || state.pid < 2) {
  throw new Error('Unrecognized process record. No process was stopped.')
}
let command
try { command = execFileSync('ps', ['-p', String(state.pid), '-o', 'command='], { encoding: 'utf8' }) } catch {
  unlinkSync(pidFile)
  console.log('The evaluation is already stopped.')
  process.exit(0)
}
if (!command.includes(state.script) || !command.includes('--supervise')) throw new Error('The recorded PID belongs to another process. No process was stopped.')
process.kill(state.pid, 'SIGTERM')
for (let attempt = 0; attempt < 30; attempt++) {
  if (!existsSync(pidFile)) { console.log('Evaluation stopped.'); process.exit(0) }
  await new Promise((resolve) => setTimeout(resolve, 100))
}
throw new Error('Shutdown is taking longer than expected. Check demo.log.')
