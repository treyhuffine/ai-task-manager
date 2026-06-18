/**
 * End-to-end beamd verification.
 *
 * Brings a real tunnel up against a live edge and proves the URL serves the
 * local app over HTTPS, then tears it down. Flow drives the machine's shared
 * `~/.beamd/` account (no `--config`), so this logs into a throwaway HOME and
 * uses it — never touching your real `~/.beamd`.
 *
 * Usage:
 *   BEAMD_SERVER=beamd.ai \
 *   BEAMD_TOKEN=<workspace api key or oss token> \
 *   FLOW_BEAMD_BIN=/path/to/beamd \    # optional; else @beamd/cli / PATH
 *   pnpm tsx scripts/verify-beamd.ts
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

async function main() {
  const server = process.env.BEAMD_SERVER?.trim();
  const token = process.env.BEAMD_TOKEN?.trim();
  if (!server || !token) {
    console.error('Set BEAMD_SERVER and BEAMD_TOKEN.');
    process.exit(2);
  }

  // Isolate ~/.beamd to a throwaway HOME so we don't touch the real account.
  // Use a SHORT base, NOT os.tmpdir(): beamd's per-server agent socket lives at
  // `<HOME>/.beamd/agents/<server>.sock`, and macOS's long `/var/folders/...`
  // tmpdir overflows the ~104-char AF_UNIX path limit → the tunnel agent can't
  // bind ("agent failed to start"). (Surfaced at beamd 0.0.5, whose socket name
  // grew from `default.sock` to `<server>_<port>.sock`.) `/tmp` keeps it short;
  // Windows uses named pipes, not path-bound sockets, so the limit is moot.
  const tmpBase = process.platform === 'win32' ? os.tmpdir() : '/tmp';
  const home = fs.mkdtempSync(path.join(tmpBase, 'bd-verify-'));
  process.env.HOME = home;

  const { beamdLogin, beamdStatus, beamdOpen, beamdClose, beamdConnectedServer } =
    await import('@/lib/preview/beamd/cli');
  const { allocatePort, isPortListening } = await import('@/lib/preview/net');

  await beamdLogin({ server, token });
  console.log('• connected to', await beamdConnectedServer());
  console.log('• status:', JSON.stringify(await beamdStatus()));

  const port = await allocatePort();
  const marker = `flow-beamd-ok-${port}`;
  const app = http.createServer((_q, s) => s.end(marker));
  await new Promise<void>((r) => app.listen(port, '127.0.0.1', r));
  if (!(await isPortListening(port))) throw new Error('local app failed to listen');
  console.log(`• local app on :${port}`);

  const name = `flow-verify-${port}`;
  let url: string | null = null;
  try {
    const opened = await beamdOpen(port, name);
    url = opened.url;
    console.log('• opened tunnel:', JSON.stringify(opened));

    const res = await fetch(url, { redirect: 'follow' });
    const body = await res.text();
    const ok = res.ok && body.includes(marker);
    console.log(`• GET ${url} → ${res.status}, body match: ${body.includes(marker)}`);
    if (!ok) {
      console.error('✗ public URL did not serve the local app.');
      process.exit(1);
    }
    console.log('\n✅ PASS — beamd serves the local app over HTTPS with a real cert.');
  } finally {
    if (url) {
      const closed = await beamdClose(name).catch((e) => ({ error: String(e) }));
      console.log('• closed tunnel:', JSON.stringify(closed));
    }
    app.close();
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch((err) => {
  console.error('✗ verify-beamd failed:', err);
  process.exit(1);
});
