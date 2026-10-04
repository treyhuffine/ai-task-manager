import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { openOwnedTunnel, closeOwnedTunnel } from '../../src/lib/preview/beamd/ownership';
import { getRemoteBaseUrl } from '../../src/lib/auth/bootstrap';
import { evaluationDirectory } from '../../src/lib/server/operations/plugins/evaluation';

const root = evaluationDirectory();
const here = path.dirname(fileURLToPath(import.meta.url));
const descriptor = path.join(root, 'remote.json');
const tunnels = [[48885, 'ri-plugin-examples'], [48886, 'ri-plugin-sandbox']] as const;

async function main() {
  if (process.argv[2] === 'stop') {
    if (fs.existsSync(descriptor)) {
      const record = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
      const identity = spawnSync('ps', ['-p', String(record.pid), '-o', 'command='], { encoding: 'utf8' });
      if (identity.status === 0) {
        if (!identity.stdout.includes(path.join(here, 'remote-server.mjs') + ' --serve')) throw new Error('The recorded process is not this example host. It was left running.');
        process.kill(record.pid, 'SIGTERM');
      } else fs.unlinkSync(descriptor);
    }
    for (const [port, name] of tunnels) await closeOwnedTunnel(port, name);
    console.log('Remote examples stopped. Ri was left running.');
    return;
  }
  const parentOrigin = getRemoteBaseUrl();
  if (!parentOrigin || new URL(parentOrigin).protocol !== 'https:') throw new Error('Configure the Home’s HTTPS remote URL in Ri first.');
  if (fs.existsSync(descriptor)) {
    const record = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    const identity = spawnSync('ps', ['-p', String(record.pid), '-o', 'command='], { encoding: 'utf8' });
    if (identity.status === 0) {
      if (!identity.stdout.includes(path.join(here, 'remote-server.mjs') + ' --serve')) throw new Error('The recorded process is not this example host. No service was changed.');
      console.log('Remote examples already running. Open Settings > Plugins in Ri.'); return;
    }
    fs.unlinkSync(descriptor);
  }
  // Never expose an unrelated listener through a newly opened tunnel.
  for (const [port] of tunnels) await new Promise<void>((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error(`Port ${port} is already in use. No service was stopped or exposed.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
  });
  const local = spawnSync(process.execPath, [path.join(here, 'start.mjs')], { stdio: 'inherit' });
  if (local.status !== 0) throw new Error('The isolated examples did not start.');
  const opened: (typeof tunnels)[number][] = [];
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const host = await openOwnedTunnel(...tunnels[0]); opened.push(tunnels[0]);
    const sandbox = await openOwnedTunnel(...tunnels[1]); opened.push(tunnels[1]);
    const key = randomBytes(32).toString('hex');
    fs.writeFileSync(path.join(root, 'remote-config.json'), JSON.stringify({ parentOrigin, hostOrigin: host.url, sandboxOrigin: sandbox.url, key }) + '\n', { mode: 0o600 });
    const log = fs.openSync(path.join(root, 'remote.log'), 'a', 0o600);
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', RI_MCP_APPS_EVAL_DIR: root };
    if (process.env.PATH) env.PATH = process.env.PATH;
    if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
    child = spawn(process.execPath, [path.join(here, 'remote-server.mjs'), '--serve'], { detached: true, stdio: ['ignore', log, log], env });
    fs.closeSync(log); child.unref();
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(descriptor) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    if (!fs.existsSync(descriptor)) throw new Error('The remote examples failed to start. Check remote.log.');
    console.log(`Ready in Ri: ${parentOrigin}/?settings=plugins\nStop: pnpm exec tsx scripts/mcp-apps-eval/remote.ts stop`);
  } catch (error) {
    child?.kill('SIGTERM');
    for (const [port, name] of opened) await closeOwnedTunnel(port, name).catch(() => {});
    throw error;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
