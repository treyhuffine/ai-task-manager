/**
 * Connecting this computer to an existing home (docs/homes-spec.md §3.1).
 *
 * The person gets a pairing link from their home the way they pair a phone
 * today (Settings, Devices: the QR code or its link, `<address>/#token=...`).
 * Connecting checks that the address answers as a Ri home with that key,
 * learns the home's stable id, name and computer, and saves the connection.
 * The home's address is only where to find it: the id is what later checks
 * compare. No new account, identity service, or tunnel is involved.
 *
 * Remote homes must use HTTPS. Plain HTTP is accepted only for this
 * computer's own loopback address, or when the person explicitly allows it
 * for a trusted home network.
 */

import { PAIRING_TOKEN_FRAGMENT_KEY } from '@/constants/app';
import { normalizeHomeUrl, writeConnection, type ConnectionConfig } from './config';
import { homeFetch, HomeRequestError, type HomeSummary } from './home-client';

export class ConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectError';
  }
}

export interface ParsedPairingLink {
  homeUrl: string;
  token: string;
}

/** Read `<address>/#token=<key>` (the fragment the pairing QR carries). */
export function parsePairingLink(raw: string): ParsedPairingLink {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ConnectError("That isn't a link. Paste the whole pairing link from your home's Devices settings.");
  }
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const token = fragment.get(PAIRING_TOKEN_FRAGMENT_KEY) ?? url.searchParams.get(PAIRING_TOKEN_FRAGMENT_KEY);
  if (!token) {
    throw new ConnectError(
      "That link has no pairing key. Use the pairing link from your home's Devices settings, the one its QR code opens.",
    );
  }
  return { homeUrl: normalizeHomeUrl(`${url.protocol}//${url.host}`), token };
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' || /^127\./.test(hostname);
}

export function assertSecureAddress(homeUrl: string, opts: { allowInsecureHttp?: boolean } = {}): void {
  const url = new URL(homeUrl);
  if (url.protocol === 'https:' || isLoopback(url.hostname) || opts.allowInsecureHttp) return;
  throw new ConnectError(
    `${homeUrl} isn't HTTPS, so the key and everything you send would cross the network unencrypted. ` +
      "Use your home's HTTPS address (its Beamd address, for example). On a home network you trust, pass --insecure-http.",
  );
}

export interface ConnectResult {
  connection: ConnectionConfig;
  home: HomeSummary;
}

/**
 * Check the home answers as a Ri home and accepts this key. Saves nothing,
 * so callers can check before changing anything on this computer.
 */
export async function verifyPairingLink(link: ParsedPairingLink, opts: { allowInsecureHttp?: boolean } = {}): Promise<HomeSummary> {
  assertSecureAddress(link.homeUrl, opts);
  const probe = { homeUrl: link.homeUrl, credential: link.token, homeName: 'your Ri', homeHostName: null };
  let res: Response;
  try {
    res = await homeFetch(probe, '/api/home');
  } catch (err) {
    if (err instanceof HomeRequestError) {
      throw new ConnectError(
        err.problem === 'unauthorized'
          ? `${link.homeUrl} didn't accept that pairing key. Make a new link in your home's Devices settings and try again.`
          : err.message,
      );
    }
    throw err;
  }
  if (res.status === 404) {
    throw new ConnectError(`${link.homeUrl} runs an older version of Ri that can't accept connected computers. Update it first.`);
  }
  if (!res.ok) throw new ConnectError(`${link.homeUrl} answered with HTTP ${res.status}.`);
  const home = (await res.json().catch(() => null)) as HomeSummary | null;
  if (!home?.id) throw new ConnectError(`${link.homeUrl} didn't answer like a Ri home.`);
  return home;
}

/** Save a connection to a home `verifyPairingLink` confirmed. */
export function saveConnection(link: ParsedPairingLink, home: HomeSummary): ConnectionConfig {
  return writeConnection({
    homeId: home.id,
    homeName: home.name,
    homeUrl: link.homeUrl,
    homeHostName: home.host?.name ?? null,
    credential: link.token,
    connectedAt: new Date().toISOString(),
    computerId: null,
  });
}

/** Check the home answers with this key, then save the connection. Nothing is saved when the check fails. */
export async function connectToHome(link: ParsedPairingLink, opts: { allowInsecureHttp?: boolean } = {}): Promise<ConnectResult> {
  const home = await verifyPairingLink(link, opts);
  return { connection: saveConnection(link, home), home };
}
