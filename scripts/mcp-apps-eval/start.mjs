import { existsSync, readFileSync, mkdirSync, openSync, closeSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { fileURLToPath } from 'node:url'
import { root, pidFile, url, serverEnv } from './config.mjs'

function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}
function probe(port, hostname, path = '/') {
  return new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { Host: `${hostname}:${port}` }, timeout: 1000 }, (res) => {
      res.resume()
      resolve(res.statusCode < 500)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.end()
  })
}
const entries = [
  ['host', 'serve.ts', 48880, 'ri-mcp-apps.127.0.0.1.nip.io'],
  ['scenario', 'main.ts', 48882, 'ri-mcp-apps.127.0.0.1.nip.io'],
  ['excalidraw-source', 'src/main.ts', 48883, 'ri-mcp-apps.127.0.0.1.nip.io'],
]

if (process.argv.includes('--supervise')) {
  const children = []
  let stopping = false
  function stop(code = 0) {
    if (stopping) return
    stopping = true
    children.forEach((child) => child.kill('SIGTERM'))
    setTimeout(() => {
      children.forEach((child) => child.kill('SIGKILL'))
      if (existsSync(pidFile) && JSON.parse(readFileSync(pidFile, 'utf8')).pid === process.pid) unlinkSync(pidFile)
      process.exit(code)
    }, 1500)
  }
  process.on('SIGINT', () => stop())
  process.on('SIGTERM', () => stop())
  for (const [project, entry] of entries) {
    const child = spawn(process.execPath, ['--import', 'tsx', entry], { cwd: join(root, project), env: serverEnv(), stdio: 'inherit' })
    children.push(child)
    child.on('error', (error) => { console.error(error); stop(1) })
    child.on('exit', (code) => { if (!stopping) { console.error(`${project} stopped (${code})`); stop(1) } })
  }
} else {
  if (existsSync(pidFile)) {
    const previous = JSON.parse(readFileSync(pidFile, 'utf8'))
    if (isAlive(previous.pid)) {
      if (await probe(48880, 'ri-mcp-apps.127.0.0.1.nip.io')) { console.log(`Already running: ${url}`); process.exit(0) }
      throw new Error('The evaluation is starting. Check demo.log or stop it before retrying.')
    }
    unlinkSync(pidFile)
  }
  for (const [project] of entries) {
    if (!existsSync(join(root, project, 'dist')) || !existsSync(join(root, project, 'node_modules'))) {
      throw new Error('Run node scripts/mcp-apps-eval/setup.mjs first.')
    }
  }
  for (const port of [48880, 48881, 48882, 48883]) {
    if (await probe(port, port === 48881 ? 'ri-mcp-sandbox.127.0.0.1.sslip.io' : 'ri-mcp-apps.127.0.0.1.nip.io')) {
      throw new Error(`Port ${port} is already in use. No existing service was stopped.`)
    }
  }
  mkdirSync(root, { recursive: true })
  const log = openSync(join(root, 'demo.log'), 'a')
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--supervise'], {
    detached: true, stdio: ['ignore', log, log], env: { ...serverEnv(), RI_MCP_APPS_EVAL_DIR: root },
  })
  writeFileSync(pidFile, JSON.stringify({ pid: child.pid, script: fileURLToPath(import.meta.url), root }) + '\n')
  closeSync(log)
  child.unref()
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if ((await Promise.all([
      probe(48880, 'ri-mcp-apps.127.0.0.1.nip.io'), probe(48881, 'ri-mcp-sandbox.127.0.0.1.sslip.io', '/sandbox.html'),
      probe(48882, 'ri-mcp-apps.127.0.0.1.nip.io', '/mcp'), probe(48883, 'ri-mcp-apps.127.0.0.1.nip.io', '/mcp'),
    ])).every(Boolean)) {
      console.log(`Running: ${url}\nStop: node scripts/mcp-apps-eval/stop.mjs\nLog: ${join(root, 'demo.log')}`)
      process.exit(0)
    }
    if (!isAlive(child.pid)) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`The evaluation did not start. Check ${join(root, 'demo.log')}`)
}
