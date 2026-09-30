/** Exercise the actual Next development server behind the desktop controller.
 * Separate from packaged acceptance: a remote dev viewer never boots Next dev.
 * All Home, credentials and installation state live in a disposable directory.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http2 from 'node:http2';
import { fixtureEnvironment } from './platform-qualification';
import { writeDesktopHomeIntent } from '../src/lib/service/desktop-role-intent';
import { ensureService, serviceStatus, stopService } from '../src/lib/service/client';
import { servicePaths } from '../src/lib/service/paths';

const repo = path.resolve(__dirname, '..');
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-desktop-dev-')));
const env: NodeJS.ProcessEnv = { ...fixtureEnvironment(process.env, { temporary }), NODE_ENV: 'development', RI_DESKTOP_MODE: 'development', NEXT_DIST_DIR: '.next-desktop-dev' };
// Prevent source .env files from restoring account credentials in this fixture.
for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_API_KEY', 'BEAMD_API_KEY']) env[name] = '';
for (const name of Object.keys(process.env)) delete process.env[name];
Object.assign(process.env, env);
fs.mkdirSync(env.HOME!, { recursive: true });
writeDesktopHomeIntent();

async function main() {
  let client: http2.ClientHttp2Session | undefined;
  const log = servicePaths().log;
  try {
    assert.equal(await serviceStatus(), null, 'A fresh fixture must never attach to an existing Home');
    const session = await ensureService({ repo, node: process.execPath, env });
    assert.equal(session.phase, 'running');
    assert.equal(session.identity.root, env.RI_ROOT);
    client = http2.connect(session.origin, { ca: session.certificate, allowPartialTrustChain: true });
    const connected = client;
    await new Promise<void>((resolve, reject) => { connected.once('connect', resolve); connected.once('error', reject); });
    assert.equal(connected.alpnProtocol, 'h2');
    const request = (pathname: string) => new Promise<{ status: number; body: string; location?: string }>((resolve, reject) => {
      const stream = connected.request({ ':path': pathname, authorization: `Bearer ${session.token}` });
      let status = 0;
      let location: string | undefined;
      let body = '';
      stream.setEncoding('utf8');
      stream.setTimeout(120_000, () => stream.destroy(new Error(`Development request timed out: ${pathname}`)));
      stream.on('response', headers => { status = Number(headers[':status']); location = headers.location; });
      stream.on('data', chunk => { body += chunk; if (body.length > 4 * 1024 * 1024) stream.destroy(new Error('Oversized development response')); });
      stream.on('end', () => resolve({ status, body, location }));
      stream.on('error', reject);
      stream.end();
    });
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).ok, true);
    console.info('Passed: fresh source Home starts with verified TLS and HTTP/2 health');
    assert.equal((await request('/api/version')).status, 200);
    console.info('Passed: development proxy and authenticated API compile and respond');
    const initial = await request('/');
    assert.equal(initial.status, 307);
    assert.equal(initial.location, '/welcome');
    const page = await request('/welcome');
    assert.equal(page.status, 200);
    assert.match(page.body, /<html/);
    console.info('Passed: the actual Next development UI compiles and renders');
  } catch (error) {
    console.error(`Development service log: ${log}`);
    if (fs.existsSync(log)) console.error(fs.readFileSync(log, 'utf8').slice(-16_384));
    throw error;
  } finally {
    client?.destroy();
    await stopService();
    assert.equal(await serviceStatus(), null, 'The fixture service must stop');
  }
  console.info(`Development acceptance passed. Disposable evidence: ${temporary}`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
