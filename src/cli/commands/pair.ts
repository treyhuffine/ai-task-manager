/**
 * `<app> pair [options]`
 *
 * Mints a NEW per-device API key on every invocation and prints one pairing
 * URL + QR code that embeds it. Each paired device ends up with its own
 * revokable key — same semantic as the web UI's Devices panel.
 *
 * Base URL resolution:
 *   • default  → saved tunnel URL, else LAN, else localhost
 *   • --lan    → force LAN IP
 *   • --local  → force localhost
 *
 * Device metadata can be overridden with `--name` and `--type`; otherwise
 * we pick sensible defaults and the user can rename in the web UI later.
 *
 * Side-effect-only flags (`--set-url`, `--clear-url`) do NOT create a key.
 */

import os from 'node:os';
import pc from 'picocolors';
import { APP_SHORT_ID } from '@/constants/app';
import {
  ensureLocalToken,
  buildPairingUrl,
  getRemoteBaseUrl,
  setRemoteBaseUrl,
  clearRemoteBaseUrl,
  getLanBaseUrl,
  getLocalBaseUrl,
  getRunningPort,
  setRunningPort,
} from '@/lib/auth/bootstrap';
import { createApiKey } from '@/lib/db/queries';
import type { DeviceType } from '@/db/types';
import { probeHealth } from '../lib/server';
import { renderTerminalQr } from '../lib/qr';

const BASE_URL_EXAMPLE = `https://${APP_SHORT_ID}.example.com`;

/** Device types the CLI is willing to assign. Excludes 'host' — that's
 *  reserved for the internal host-machine token and minted elsewhere. */
const ALLOWED_CLI_TYPES: readonly DeviceType[] = [
  'desktop',
  'laptop',
  'phone',
  'tablet',
  'cli',
  'other',
];

export interface PairOptions {
  setUrl?: string;
  clearUrl?: boolean;
  lan?: boolean;
  local?: boolean;
  name?: string;
  type?: string;
}

type BaseSource = 'tunnel' | 'lan' | 'local';

interface Chosen {
  label: string;
  base: string;
  source: BaseSource;
}

export async function pairCommand(opts: PairOptions = {}) {
  // Side-effect flags: set/clear, then exit.
  if (opts.clearUrl) {
    clearRemoteBaseUrl();
    console.log(pc.green('Cleared remote base URL.'));
    return;
  }
  if (opts.setUrl) {
    try {
      const saved = setRemoteBaseUrl(opts.setUrl);
      console.log(pc.green(`Saved remote base URL: ${saved}`));
    } catch (err) {
      console.error(pc.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
    return;
  }

  // Validate --type before doing anything irreversible.
  const deviceType = resolveDeviceType(opts.type);
  if (deviceType === null) {
    console.error(
      pc.red(
        `Invalid --type "${opts.type}". Must be one of: ${ALLOWED_CLI_TYPES.join(', ')}.`,
      ),
    );
    process.exit(1);
  }

  // Host token is used for the health probe only. It's NOT embedded in the
  // pairing URL — each pair call mints a fresh per-device key below.
  const host = ensureLocalToken();
  if (host.created) console.log(pc.green('Initialized host.'));

  // Verify the port we're about to print. Probe /api/health on the port we
  // have cached; if the server answers with a different port, trust the
  // server and refresh our cache.
  const cachedPort = getRunningPort();
  const probe = await probeHealth(cachedPort, host.plaintext);
  if (probe.status === 'ok') {
    if (probe.info.port !== cachedPort) setRunningPort(probe.info.port);
  } else {
    printProbeWarning(cachedPort, probe);
  }

  const chosen = chooseBase(opts);
  if (!chosen) {
    // Only possible when --lan is explicit but no non-loopback interface
    // was found. --local always succeeds (localhost is always available).
    console.error(
      pc.red(
        `No LAN address available on this machine. Try without \`--lan\`, or pass \`--local\` for localhost.`,
      ),
    );
    process.exit(1);
  }

  // Mint a fresh per-device key for this invocation.
  const name = (opts.name ?? '').trim() || defaultDeviceName();
  const { key, token } = createApiKey({
    name,
    device_type: deviceType,
    description: `Paired via \`${APP_SHORT_ID} pair\` from ${os.hostname()}`,
  });

  const primaryUrl = buildPairingUrl(token.plaintext, chosen.base);
  const alternates = gatherAlternates(chosen, token.plaintext);

  console.log();
  console.log(
    pc.bold(`${APP_SHORT_ID} pair`) +
      pc.dim(` — created device "${key.name}" (${key.device_type})`),
  );
  console.log();
  console.log(await renderTerminalQr(primaryUrl));

  console.log(pc.bold(`${chosen.label} (primary):`));
  console.log(`  ${primaryUrl}`);

  if (alternates.length > 0) {
    console.log();
    console.log(pc.bold('Also reachable at:'));
    const maxUrlLen = Math.max(...alternates.map((a) => a.url.length));
    for (const alt of alternates) {
      const padded = alt.url.padEnd(maxUrlLen, ' ');
      console.log(`  ${padded}  ${pc.dim(`(${alt.label})`)}`);
    }
  }

  console.log();
  console.log(pc.dim(hintFor(chosen.source, getRemoteBaseUrl())));
  console.log();
  console.log(
    pc.dim(
      `Rename or revoke this device anytime from Profile → Devices in the web app.`,
    ),
  );

  console.log();
  console.log(pc.bold('Token') + pc.dim(' (paste into any base URL as `/#t=<token>`):'));
  console.log(`  ${token.plaintext}`);
  console.log();
}

/**
 * Collect the OTHER reachable base URLs for this same token (deduped
 * against the primary). Returned as plain-text alternates — no QR — so the
 * user can grab a LAN or localhost URL without minting a second key.
 */
function gatherAlternates(
  primary: Chosen,
  token: string,
): Array<{ label: string; url: string }> {
  const normalize = (u: string) => u.replace(/\/+$/, '');
  const seen = new Set<string>([normalize(primary.base)]);

  const all: Array<{ label: string; base: string | null }> = [
    { label: 'Remote', base: getRemoteBaseUrl() },
    { label: 'Same network', base: getLanBaseUrl() },
    { label: 'This machine', base: getLocalBaseUrl() },
  ];

  const out: Array<{ label: string; url: string }> = [];
  for (const entry of all) {
    if (!entry.base) continue;
    const key = normalize(entry.base);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: entry.label, url: buildPairingUrl(token, entry.base) });
  }
  return out;
}

function defaultDeviceName(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `Paired device (${date})`;
}

/**
 * Returns the resolved DeviceType, `'other'` when unspecified, or `null`
 * when the caller passed an unknown string (→ exit with error).
 */
function resolveDeviceType(raw: string | undefined): DeviceType | null {
  if (!raw) return 'other';
  const lower = raw.toLowerCase();
  return (ALLOWED_CLI_TYPES as readonly string[]).includes(lower)
    ? (lower as DeviceType)
    : null;
}

/**
 * Resolve which base URL to print. Explicit flags win; otherwise cascade
 * remote → LAN → localhost. Returns null only when `--lan` is requested
 * on a machine with no non-loopback IPv4 interface.
 */
function chooseBase(opts: PairOptions): Chosen | null {
  if (opts.local) {
    return { label: 'This machine', base: getLocalBaseUrl(), source: 'local' };
  }
  if (opts.lan) {
    const lan = getLanBaseUrl();
    if (!lan) return null;
    return { label: 'Same network', base: lan, source: 'lan' };
  }

  const tunnel = getRemoteBaseUrl();
  if (tunnel) {
    return { label: 'Remote', base: tunnel, source: 'tunnel' };
  }

  const lan = getLanBaseUrl();
  if (lan) {
    return { label: 'Same network', base: lan, source: 'lan' };
  }

  return { label: 'This machine', base: getLocalBaseUrl(), source: 'local' };
}

function hintFor(source: BaseSource, tunnel: string | null): string {
  switch (source) {
    case 'tunnel':
      return `Using saved remote URL. Switch with \`--lan\` / \`--local\`, change with \`--set-url <url>\`, or forget with \`--clear-url\`.`;
    case 'lan':
      if (!tunnel) {
        return `No remote URL saved — using your LAN address. Set one with \`${APP_SHORT_ID} pair --set-url ${BASE_URL_EXAMPLE}\` to pair off-network devices.`;
      }
      return `Using LAN address (overriding saved remote URL). Run without \`--lan\` to use the remote URL.`;
    case 'local':
      if (!tunnel) {
        return `Only localhost is usable from this machine. Set a remote URL with \`${APP_SHORT_ID} pair --set-url ${BASE_URL_EXAMPLE}\` for off-network pairing.`;
      }
      return `Using localhost (overriding saved remote URL). Run without \`--local\` to use the remote URL.`;
  }
}

function printProbeWarning(
  port: number,
  probe: Exclude<Awaited<ReturnType<typeof probeHealth>>, { status: 'ok' }>,
) {
  switch (probe.status) {
    case 'offline':
      console.log(
        pc.yellow(
          `! Nothing is listening on port ${port}. URL below assumes that port — start the server or run \`${APP_SHORT_ID} pair\` again afterward.`,
        ),
      );
      return;
    case 'unreachable':
      console.log(
        pc.yellow(
          `! Port ${port} is open but /api/health didn't respond (${probe.detail}). If the dev server is still compiling, try again in a few seconds.`,
        ),
      );
      return;
    case 'unauthorized':
      console.log(
        pc.yellow(
          `! Server on port ${port} rejected the host token (HTTP ${probe.httpStatus}). The token in config may not match the server's database.`,
        ),
      );
      return;
    case 'unknown-app':
      console.log(
        pc.yellow(
          `! Something is running on port ${port} but it doesn't look like ${APP_SHORT_ID} (${probe.detail}).`,
        ),
      );
      return;
  }
}
