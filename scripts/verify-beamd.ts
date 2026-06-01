/**
 * End-to-end beamd verification (Phase 0 "confirm beamd").
 *
 * Brings a real tunnel up against a live edge and proves the URL serves the
 * local app over HTTPS with a real cert, then tears it down. Uses an
 * isolated temp data dir so it never touches your real config.
 *
 * Usage:
 *   BEAMD_SERVER=tunnel.example.com:443 \
 *   BEAMD_TOKEN=<token> \
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

  // Isolate the data dir so we write a throwaway beamd.yaml.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-beamd-verify-'));
  process.env.FLOW_ROOT = root;

  const { writeBeamdConfig, getBeamdConfigPath } = await import('@/lib/preview/beamd/config');
  const { beamdStatus, beamdOpen, beamdClose, setBeamdBinOverride } = await import('@/lib/preview/beamd/cli');
  const { allocatePort, isPortListening } = await import('@/lib/preview/net');

  if (process.env.FLOW_BEAMD_BIN) setBeamdBinOverride(process.env.FLOW_BEAMD_BIN);
  writeBeamdConfig({ server, token });
  console.log(`• wrote ${getBeamdConfigPath()}`);

  // 1) status — informational. `healthy` means "has a live session", so it's
  // false until a tunnel is up; the real proof is open + fetch below.
  const status = await beamdStatus();
  console.log('• status:', JSON.stringify(status));

  // 2) a tiny local app
  const port = await allocatePort();
  const marker = `flow-beamd-ok-${port}`;
  const app = http.createServer((_q, s) => s.end(marker));
  await new Promise<void>((r) => app.listen(port, '127.0.0.1', r));
  if (!(await isPortListening(port))) throw new Error('local app failed to listen');
  console.log(`• local app on :${port}`);

  const name = `flow-verify-${port}`;
  let url: string | null = null;
  try {
    // 3) open tunnel
    const opened = await beamdOpen(port, name);
    url = opened.url;
    console.log('• opened tunnel:', JSON.stringify(opened));

    // 4) fetch the public URL (real cert)
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
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch((err) => {
  console.error('✗ verify-beamd failed:', err);
  process.exit(1);
});
