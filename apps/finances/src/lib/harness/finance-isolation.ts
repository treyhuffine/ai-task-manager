/** Receipt extraction is a separate, fail-closed process profile, never a prompt permission. */
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { HarnessId } from './registry';
import { registerHarnessRuntimeSecret } from './redaction';
const exec = promisify(execFile);
export class UnsupportedFinanceExtraction extends Error {
  readonly code = 'unsupported_extraction';
}
export const extractionSupport: Record<HarnessId, string> = {
  claude:
    'macOS Seatbelt, tool-less subscription CLI, restricted CONNECT proxy',
  codex: 'Not qualified',
  cursor: 'Not qualified',
  opencode: 'Not qualified',
  antigravity: 'Not qualified',
};
const sbString = (s: string) => JSON.stringify(s);
/** The child may write only its disposable work area and contact only the host proxy. */
export function extractionSandbox(binary: string, work: string, port: number) {
  work = realpathSync(work);
  return `(version 3)\n(deny default)\n(import "dyld-support.sb")\n(allow syscall*)\n(allow dynamic-code-generation)\n(allow mach-bootstrap)\n(allow process-fork)\n(allow process-info* (target self))\n(allow file-map-executable (subpath "/System") (subpath "/private/preboot/Cryptexes/OS") (subpath "/usr/lib") (literal ${sbString(binary)}))\n(allow process-exec (literal ${sbString(binary)}))\n(allow sysctl-read)\n(allow mach-lookup (global-name "com.apple.system.logger") (global-name "com.apple.system.opendirectoryd.libinfo"))\n(allow file-read-metadata)\n(allow file-read* file-test-existence (subpath "/System") (subpath "/private/preboot/Cryptexes/OS") (subpath "/usr/lib") (subpath "/usr/share") (subpath "/Library/Apple") (subpath "/private/etc/ssl") (literal "/dev/urandom") (literal "/dev/random") (literal "/dev/null") (literal "/dev/zero") (literal ${sbString(binary)}) (subpath ${sbString(work)}))\n(allow file-write* (subpath ${sbString(work)}) (literal "/dev/null"))\n(allow network-outbound (remote ip "localhost:${port}"))\n`;
}
export async function extractionProxy() {
  const sockets = new Set<Duplex>();
  const server = http.createServer((_req, res) => {
    res.writeHead(403);
    res.end();
  });
  server.on('connect', (req, client, head) => {
    // No arbitrary URLs, IPs, ports, redirects, mail endpoints or MCP servers.
    if (req.url !== 'api.anthropic.com:443') {
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream = net.connect({ host: 'api.anthropic.com', port: 443 });
    sockets.add(upstream);
    sockets.add(client);
    upstream.on('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    const close = () => {
      upstream.destroy();
      client.destroy();
      sockets.delete(upstream);
      sockets.delete(client);
    };
    upstream.on('error', close);
    client.on('error', close);
    client.on('close', close);
    upstream.on('close', close);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
async function subscriptionToken() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN)
    return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  let raw: string;
  try {
    raw = await fs.readFile(
      path.join(os.homedir(), '.claude', '.credentials.json'),
      'utf8',
    );
  } catch {
    try {
      raw = (
        await exec(
          '/usr/bin/security',
          ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
          { timeout: 5000, maxBuffer: 64000 },
        )
      ).stdout;
    } catch {
      throw new UnsupportedFinanceExtraction(
        'Receipt extraction needs a Claude subscription token. Manual review remains available.',
      );
    }
  }
  const token = JSON.parse(raw)?.claudeAiOauth?.accessToken;
  if (typeof token !== 'string' || !token)
    throw new UnsupportedFinanceExtraction(
      'No subscription authentication available for isolated extraction',
    );
  return token;
}
/** Adversarial probe runs the actual OS boundary, before any evidence is sent. */
export async function qualifyExtractionBoundary(
  profile: string,
  work: string,
  port: number,
) {
  work = await fs.realpath(work);
  const probe = path.join(work, 'boundary-probe'),
    probeProfile = path.join(work, 'probe.sb');
  const outside = await fs.mkdtemp(
    path.join(os.tmpdir(), 'finance-canary-'),
  );
  const canary = path.join(outside, 'credentials');
  await fs.writeFile(canary, 'private-canary', { mode: 0o600 });
  const source = `#include <fcntl.h>\n#include <unistd.h>\n#include <sys/socket.h>\n#include <sys/wait.h>\n#include <arpa/inet.h>\n#include <errno.h>\nint main(int argc,char **argv){ if(open(argv[1],O_RDONLY)>=0)return 11; pid_t p=fork();if(p<0)return 15;if(p==0){execl("/bin/sh","sh","-c","true",NULL);_exit(errno==EPERM?0:12);}int s;waitpid(p,&s,0);if(s!=0)return 12;int fd=socket(AF_INET,SOCK_STREAM,0);struct sockaddr_in a={.sin_family=AF_INET,.sin_port=htons(1)};inet_pton(AF_INET,"127.0.0.1",&a.sin_addr);int r=connect(fd,(struct sockaddr*)&a,sizeof(a));if(r==0||errno!=EPERM)return 13;write(1,"isolated",8);return 0;}`;
  const sourcePath = path.join(work, 'probe.c');
  await fs.writeFile(sourcePath, source, { mode: 0o600 });
  try {
    await exec('/usr/bin/clang', [sourcePath, '-o', probe], {
      timeout: 10000,
      maxBuffer: 4000,
    });
    const probeBinary = await fs.realpath(probe);
    await fs.writeFile(
      probeProfile,
      profile.replace(
        /\(allow process-exec[^\n]+/,
        `(allow process-exec (literal ${sbString(probeBinary)}))`,
      ),
      { mode: 0o600 },
    );
    const result = await exec(
      '/usr/bin/sandbox-exec',
      ['-f', probeProfile, probe, canary],
      {
        cwd: work,
        env: { PATH: '/usr/bin:/bin', TMPDIR: work, NODE_ENV: 'production' },
        timeout: 5000,
        maxBuffer: 4000,
      },
    );
    if (result.stdout.trim() !== 'isolated')
      throw new Error('Boundary probe failed');
    const rejected = await new Promise<boolean>((resolve) => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () =>
        s.write(
          'CONNECT unapproved.invalid:443 HTTP/1.1\r\nHost: unapproved.invalid:443\r\n\r\n',
        ),
      );
      s.on('data', (d) => {
        resolve(d.toString().includes('403'));
        s.destroy();
      });
      s.on('error', () => resolve(false));
      s.setTimeout(1500, () => {
        resolve(false);
        s.destroy();
      });
    });
    if (!rejected) throw new Error('Proxy authorization probe failed');
  } catch (error) {
    throw new UnsupportedFinanceExtraction(
      `The operating system did not enforce the extraction boundary. Receipt extraction is unavailable. ${typeof error === 'object' && error && 'stderr' in error ? `exit ${'code' in error ? error.code : ''} signal ${'signal' in error ? error.signal : ''}: ${String(error.stderr).slice(-1000)}` : 'Boundary probe failed'}`,
    );
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
}
export async function withFinanceExtractionProfile<T>(
  harness: HarnessId,
  run: (profile: {
    cwd: string;
    command: string;
    extraArgs: string[];
  }) => Promise<T>,
): Promise<T> {
  if (harness !== 'claude' || process.platform !== 'darwin')
    throw new UnsupportedFinanceExtraction(
      `Receipt extraction is not qualified for ${harness} on ${process.platform}. Use manual review or deterministic import.`,
    );
  const binary = await fs.realpath(
    process.env.CLAUDE_COMMAND ?? path.join(os.homedir(), '.local/bin/claude'),
  );
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'finance-extract-')),
    requestedWork = path.join(dir, 'work');
  await fs.mkdir(requestedWork, { mode: 0o700 });
  const work = await fs.realpath(requestedWork);
  const proxy = await extractionProxy();
  try {
    const profile = extractionSandbox(binary, work, proxy.port);
    await qualifyExtractionBoundary(profile, work, proxy.port);
    const help = (
      await exec(binary, ['--help'], { timeout: 10000, maxBuffer: 100000 })
    ).stdout;
    for (const flag of [
      '--tools',
      '--strict-mcp-config',
      '--setting-sources',
      '--no-session-persistence',
    ])
      if (!help.includes(flag))
        throw new UnsupportedFinanceExtraction(
          'Installed Claude CLI does not support the qualified extraction flags',
        );
    const token = await subscriptionToken();
    registerHarnessRuntimeSecret(token, 'finance-extraction-subscription');
    const profilePath = path.join(dir, 'extract.sb'),
      launcher = path.join(dir, 'launch');
    await fs.writeFile(profilePath, profile, { mode: 0o600 });
    // Scrub inherited host credentials, provider keys, hooks, MCP and project config at spawn.
    // The one selected subscription token stays in the protected launcher environment, never argv.
    const env = {
      PATH: '/usr/bin:/bin',
      TMPDIR: work,
      CLAUDE_CODE_TMPDIR: work,
      BUN_TMPDIR: work,
      CLAUDE_CONFIG_DIR: path.join(work, '.claude'),
      CLAUDE_CODE_OAUTH_TOKEN: token,
      HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
      HTTP_PROXY: `http://127.0.0.1:${proxy.port}`,
      NO_PROXY: '',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
      DISABLE_TELEMETRY: '1',
    };
    const launchCode = `const {spawn}=require('node:child_process');const env=${JSON.stringify(env)};const child=spawn('/usr/bin/sandbox-exec',['-f',${JSON.stringify(profilePath)},${JSON.stringify(binary)},...process.argv.slice(2)],{cwd:${JSON.stringify(work)},env,stdio:'inherit'});child.on('exit',(c)=>process.exit(c??1));child.on('error',()=>process.exit(1));`;
    await fs.writeFile(launcher, `#!${process.execPath}\n${launchCode}\n`, {
      mode: 0o700,
    });
    return await run({
      cwd: work,
      command: launcher,
      extraArgs: [
        '--tools',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--setting-sources',
        '',
        '--no-session-persistence',
      ],
    });
  } finally {
    await proxy.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}
