/** Trusted ordinary-Node setup operations. Never expose this module to a remote renderer. */
import { z } from 'zod';
import { PAIRING_TOKEN_FRAGMENT_KEY } from '../src/constants/app';
import { getInstallationRole } from '../src/lib/config/role';
import { readConnection, writeConnection, rememberDeviceId, rememberedDeviceId, type ConnectionConfig } from '../src/lib/connection/config';
import { parsePairingLink } from '../src/lib/connection/connect';
import { homeFetch, HomeRequestError, type HomeSummary } from '../src/lib/connection/home-client';
import { thisDeviceFacts } from '../src/lib/home/device-name';
import { readWorkerConfig, writeWorkerConfig } from '../src/lib/worker/config';
import { resolveServiceRole, type ServiceRole } from '../src/lib/service/role';
import { hasDesktopHomeIntent, writeDesktopHomeIntent } from '../src/lib/service/desktop-role-intent';
import { serviceStatus } from '../src/lib/service/client';
import { acquireWorkerLock } from '../src/lib/worker/lock';
import { exclusiveDatabaseAccess } from '../src/lib/service/maintenance';
import { WORKER_PROTOCOL } from '../src/lib/workers/protocol';
import { runtimeReleaseIdentity, runtimePeerRelease } from '../src/lib/releases/runtime-identity';

const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('inspect') }).strict(),
  z.object({ action: z.literal('create-home') }).strict(),
  z.object({ action: z.literal('connect'), pairingLink: z.string().min(1).max(8192) }).strict(),
  z.object({ action: z.literal('enable-worker'), consent: z.literal(true) }).strict(),
  z.object({ action: z.literal('session') }).strict(),
]);
export type ConnectionSetupRequest = z.infer<typeof requestSchema>;
export interface ConnectionSetupStatus {
  role: ServiceRole['role'];
  homeSelected: boolean;
  home: { id: string; url: string; name: string; hostName: string | null } | null;
  deviceId: string | null;
  workerEnrolled: boolean;
  reason?: string;
}
/** This credential is for Electron main only. It must never enter setup renderer state or logs. */
export interface ConnectedViewerSession {
  homeUrl: string; homeId: string; homeName: string; deviceId: string | null; signInKey: string;
}
export type ConnectionSetupResult = ConnectionSetupStatus | ConnectedViewerSession;
export type ConnectionSetupReply = { ok: true; result: ConnectionSetupResult } | { ok: false; error: string };

/** Desktop accepts only a trusted HTTPS origin, or an explicitly enabled loopback development origin. */
export function parseDesktopPairingLink(raw: string, development = false) {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error('Paste the complete pairing link from your Home’s Devices settings.'); }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(development && url.protocol === 'http:' && loopback))) {
    throw new Error('Use your Home’s HTTPS pairing link. Plain HTTP is supported only for local development.');
  }
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (url.pathname !== '/' || url.search || fragment.getAll(PAIRING_TOKEN_FRAGMENT_KEY).length !== 1 || [...fragment.keys()].some(key => key !== PAIRING_TOKEN_FRAGMENT_KEY)) {
    throw new Error('Use the unmodified pairing link from your Home’s Devices settings.');
  }
  const parsed = parsePairingLink(raw);
  if (!parsed.token || parsed.token.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(parsed.token)) throw new Error('That pairing key is invalid.');
  return parsed;
}

function checkedAddress(connection: ConnectionConfig, development: boolean) {
  // Use the same origin validation for stored records before releasing a credential.
  const parsed = parseDesktopPairingLink(`${connection.homeUrl}/#${PAIRING_TOKEN_FRAGMENT_KEY}=${encodeURIComponent(connection.credential)}`, development);
  if (parsed.homeUrl !== connection.homeUrl) throw new Error('The saved Home address is invalid. Connect it again.');
}

async function jsonAtHome(connection: ConnectionConfig, route: string, body?: unknown): Promise<unknown> {
  const response = await homeFetch(connection, route, {
    redirect: 'error', ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  });
  // Never echo an untrusted response, which could contain the credential we sent.
  if (!response.ok) throw new HomeRequestError(response.status >= 500 || response.status === 408 || response.status === 429 ? 'unreachable' : 'error',
    `Your Home could not complete setup (HTTP ${response.status}). Check its version and device access, then retry.`, response.status);
  const length = Number(response.headers.get('content-length'));
  if (length > 64 * 1024) throw new Error('Your Home returned an oversized setup response.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Your Home returned an empty setup response.');
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 64 * 1024) throw new Error('Your Home returned an oversized setup response.');
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Your Home returned an invalid setup response.'); }
  } finally { await reader.cancel().catch(() => {}); }
}

const homeSchema = z.object({ id: z.string().min(1).max(200), kind: z.literal('personal'), name: z.string().min(1).max(200), host: z.object({ id: z.string().min(1), name: z.string(), platform: z.string().nullable() }) });
async function verifiedHome(connection: ConnectionConfig, development: boolean, expectedId?: string): Promise<HomeSummary> {
  checkedAddress(connection, development);
  const parsed = homeSchema.safeParse(await jsonAtHome(connection, '/api/home'));
  if (!parsed.success) throw new Error('This address did not answer as a personal Ri Home.');
  if (expectedId && parsed.data.id !== expectedId) throw new Error('This address now belongs to a different Home. Your saved connection was left unchanged.');
  return parsed.data;
}


const devicesSchema = z.array(z.object({ id: z.string(), kind: z.string(), status: z.string(), isHome: z.boolean(), keys: z.array(z.object({ role: z.string(), current: z.boolean() })) }));
async function verifySignInDevice(connection: ConnectionConfig, home: HomeSummary): Promise<string> {
  const devices = devicesSchema.safeParse(await jsonAtHome(connection, '/api/devices'));
  const current = devices.success ? devices.data.filter(device => device.keys.some(key => key.current)) : [];
  if (current.length !== 1 || current[0].status !== 'active') throw new Error('This pairing key does not identify an active device. Make a new pairing link in Devices settings.');
  const device = current[0];
  if (device.isHome || device.id === home.host.id) throw new Error('That link belongs to the Home computer. Make a separate pairing link for this computer in Devices settings.');
  if (!device.keys.some(key => key.current && key.role === 'sign_in')) throw new Error('Use a device sign-in link to connect. A worker credential cannot sign in to the desktop.');
  if (device.kind !== 'computer') throw new Error('That pairing link belongs to a phone or another kind of device. Make a separate computer pairing link in Devices settings.');
  return device.id;
}

function inspect(): ConnectionSetupStatus {
  const role = resolveServiceRole();
  const connection = readConnection();
  return {
    role: role.role, homeSelected: hasDesktopHomeIntent(),
    home: connection ? { id: connection.homeId, url: connection.homeUrl, name: connection.homeName, hostName: connection.homeHostName } : null,
    deviceId: connection?.deviceId ?? null, workerEnrolled: role.role === 'worker',
    ...('message' in role ? { reason: role.message } : {}),
  };
}

const registeredSchema = z.object({ ok: z.literal(true), result: z.object({ device: z.object({ id: z.string().min(1) }) }) });
async function registerDevice(connection: ConnectionConfig, home: HomeSummary, preferredId: string | null) {
  const response = registeredSchema.safeParse(await jsonAtHome(connection, '/api/orchestrator/actions/register_device', { ...thisDeviceFacts(), deviceId: preferredId }));
  if (!response.success) throw new Error('Your Home did not register this device. Make a pairing link for this computer in Devices settings.');
  const deviceId = response.data.result.device.id;
  if (deviceId === home.host.id) throw new Error('That link belongs to the Home computer. Make a separate pairing link for this computer in Devices settings.');
  if (preferredId && preferredId !== deviceId) throw new Error('Your Home could not keep this computer’s existing device identity. Its enrollment was left unchanged.');
  return deviceId;
}

async function connect(pairingLink: string, development: boolean): Promise<ConnectionSetupStatus> {
  const role = resolveServiceRole();
  if (!['first-run', 'retired', 'worker', 'viewer'].includes(role.role)) throw new Error('This installation already has a Home. Setup never replaces it or moves its data.');
  const previous = readConnection();
  const link = parseDesktopPairingLink(pairingLink, development);
  const candidate: ConnectionConfig = { version: 1, homeId: '', homeName: 'your Ri', homeUrl: link.homeUrl, homeHostName: null, credential: link.token, connectedAt: previous?.connectedAt ?? new Date().toISOString(), deviceId: null };
  const home = await verifiedHome(candidate, development, previous?.homeId);
  await verifySignInDevice(candidate, home);
  const priorWorker = readWorkerConfig();
  if (priorWorker && priorWorker.homeId !== home.id) throw new Error('This installation has an enrollment for another Home. Disable it before connecting elsewhere.');
  let workerLock: Awaited<ReturnType<typeof acquireWorkerLock>> | undefined;
  if (priorWorker && previous && previous.homeUrl !== candidate.homeUrl) {
    const owner = await serviceStatus();
    // Stop is a deliberate local action. A momentarily idle worker could receive
    // new work immediately, so an idle snapshot cannot authorize replacement.
    if (owner && (owner.worker?.enabled !== false || owner.worker.pid)) throw new Error('Stop local execution before changing your Home address. Saved work and enrollment stay here, and you can resume after reconnecting.');
    try { workerLock = await acquireWorkerLock(); }
    catch { throw new Error('Stop the worker running on this device before changing your Home address.'); }
  }
  try {
    candidate.homeId = home.id; candidate.homeName = home.name; candidate.homeHostName = home.host.name;
    const preferred = priorWorker?.deviceId ?? previous?.deviceId ?? rememberedDeviceId(home.id);
    candidate.deviceId = await registerDevice(candidate, home, preferred);
    await verifiedHome(candidate, development, home.id);
    // Recheck immediately before publishing. The access lock excludes a managed
    // Home boot; comparison also catches another CLI changing the connection.
    const expectedRole = previous ? 'connected' : 'fresh';
    if (getInstallationRole() !== expectedRole || JSON.stringify(readConnection()) !== JSON.stringify(previous)) throw new Error('This installation changed during setup. Nothing was saved.');
    rememberDeviceId(home.id, candidate.deviceId);
    writeConnection(candidate);
    return inspect();
  } finally { workerLock?.release(); }
}

async function enableWorker(development: boolean): Promise<ConnectionSetupStatus> {
  if (getInstallationRole() !== 'connected') throw new Error('Connect this device to a Home before enabling local execution.');
  const connection = readConnection()!;
  const home = await verifiedHome(connection, development, connection.homeId);
  const signInDeviceId = await verifySignInDevice(connection, home);
  const existing = readWorkerConfig();
  if (existing) {
    if (existing.homeId !== connection.homeId || existing.deviceId !== signInDeviceId || (connection.deviceId && existing.deviceId !== connection.deviceId)) throw new Error('This installation has a different worker enrollment. Stop and resolve it before enrolling again.');
    // Never rotate an enrolled worker's key or strand its pending journal on retry.
    return inspect();
  }
  const deviceId = await registerDevice(connection, home, connection.deviceId ?? rememberedDeviceId(home.id));
  const registered = writeConnection({ ...connection, deviceId });
  rememberDeviceId(home.id, deviceId);
  const grant = z.object({ code: z.string().min(1), device: z.object({ id: z.string() }) }).safeParse(await jsonAtHome(registered, '/api/workers/grants', { deviceId }));
  if (!grant.success || grant.data.device.id !== deviceId) throw new Error('Your Home did not authorize local execution for this device.');
  const enrolled = z.object({ homeId: z.string(), deviceId: z.string(), deviceName: z.string().optional(), workerKey: z.string().min(1) }).safeParse(await jsonAtHome(registered, '/api/workers/enroll', {
    code: grant.data.code, ...thisDeviceFacts(), protocol: WORKER_PROTOCOL,
    version: runtimeReleaseIdentity().version, compatibility: runtimePeerRelease(),
  }));
  if (!enrolled.success || enrolled.data.homeId !== home.id || enrolled.data.deviceId !== deviceId) throw new Error('Your Home returned an enrollment for a different device. Nothing was enabled.');
  writeWorkerConfig({ homeId: home.id, deviceId, deviceName: enrolled.data.deviceName ?? thisDeviceFacts().name, workerKey: enrolled.data.workerKey, enrolledAt: new Date().toISOString() });
  return inspect();
}

/** Inspect is read-only. Mutations exclude another setup and managed DB boot without opening user data. */
export async function connectionSetup(raw: unknown, options: { development?: boolean } = {}): Promise<ConnectionSetupResult> {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Invalid desktop setup request.');
  const request = parsed.data;
  const development = options.development === true;
  if (request.action === 'inspect') return inspect();
  if (request.action === 'session') {
    if (getInstallationRole() !== 'connected') throw new Error('This installation is not connected to a Home.');
    const connection = readConnection()!;
    const home = await verifiedHome(connection, development, connection.homeId);
    const deviceId = await verifySignInDevice(connection, home);
    const localWorker = readWorkerConfig();
    const expectedDeviceId = connection.deviceId ?? (localWorker?.homeId === home.id ? localWorker.deviceId : null);
    if (expectedDeviceId && deviceId !== expectedDeviceId) throw new Error('This sign-in key belongs to a different device. Update the Home connection with a pairing link for this computer before opening it.');
    return { homeUrl: connection.homeUrl, homeId: home.id, homeName: home.name, deviceId, signInKey: connection.credential };
  }
  let release: () => void;
  try { release = exclusiveDatabaseAccess(); } catch { throw new Error('This installation is busy. Finish its current setup or stop its Home before changing its role.'); }
  try {
    if (request.action === 'create-home') { writeDesktopHomeIntent(); return inspect(); }
    if (request.action === 'connect') return await connect(request.pairingLink, development);
    return await enableWorker(development);
  } finally { release(); }
}
