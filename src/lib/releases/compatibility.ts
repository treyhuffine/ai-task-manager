/** Wire and local-storage contracts are independent of the display version.
 * Protocol 3 is deliberately absent: its computer/device fields differ. */
import { z } from 'zod';
import { API_PROTOCOL } from './api-contract';

const versions = z.array(z.number().int().positive()).min(1).max(16);
const names = z.array(z.string().regex(/^[a-z0-9][a-z0-9.-]{0,79}$/)).max(64);
const storage = z.object({ read: versions, write: z.number().int().positive() }).strict();
export const RuntimeCompatibilitySchema = z.object({
  format: z.literal(1), workerProtocols: versions, apiProtocols: versions,
  capabilities: names, requiredCapabilities: names,
  journal: z.object({ commands: storage, events: storage }).strict(),
  config: storage, nativeBridge: versions,
}).strict();
export type RuntimeCompatibility = z.infer<typeof RuntimeCompatibilitySchema>;
export const CURRENT_COMPATIBILITY: RuntimeCompatibility = {
  format: 1, workerProtocols: [4], apiProtocols: [API_PROTOCOL],
  capabilities: ['worker.protocol4', 'durable-journals.v1', 'compatibility.v1', 'safe-update-pause.v1'],
  requiredCapabilities: ['worker.protocol4'],
  journal: { commands: { read: [1], write: 1 }, events: { read: [1], write: 1 } },
  config: { read: [1], write: 1 }, nativeBridge: [1],
};
export const ReleaseIdentitySchema = z.object({
  version: z.string().min(1).max(80), build: z.string().min(1).max(160), source: z.enum(['packaged', 'source']),
}).strict();
export const PeerReleaseSchema = z.object({ release: ReleaseIdentitySchema, compatibility: RuntimeCompatibilitySchema }).strict();
export type PeerRelease = z.infer<typeof PeerReleaseSchema>;
export type CompatibilityResult =
  | { compatible: true; protocol: number; capabilities: string[] }
  | { compatible: false; update: 'home' | 'worker' | 'both'; reason: string };

/** An authenticated protocol-4 peer without metadata has exactly the known
 * baseline, not imaginary support for optional bridge features. */
export function legacyCompatibility(protocol: number): RuntimeCompatibility {
  return { ...CURRENT_COMPATIBILITY, workerProtocols: [protocol], capabilities: protocol === 4 ? ['worker.protocol4'] : [], requiredCapabilities: [] };
}
export function negotiateWorker(home: RuntimeCompatibility, worker: RuntimeCompatibility): CompatibilityResult {
  if (!home.apiProtocols.some(p => worker.apiProtocols.includes(p))) return { compatible: false,
    update: Math.max(...home.apiProtocols) < Math.min(...worker.apiProtocols) ? 'home' : 'worker',
    reason: 'These releases do not share a supported Home API.' };
  const common = home.workerProtocols.filter(p => worker.workerProtocols.includes(p));
  if (!common.length) {
    const update = Math.max(...home.workerProtocols) < Math.min(...worker.workerProtocols) ? 'home'
      : Math.max(...worker.workerProtocols) < Math.min(...home.workerProtocols) ? 'worker' : 'both';
    return { compatible: false, update, reason: 'These releases do not share a supported worker protocol.' };
  }
  const workerMissing = home.requiredCapabilities.filter(c => !worker.capabilities.includes(c));
  const homeMissing = worker.requiredCapabilities.filter(c => !home.capabilities.includes(c));
  if (workerMissing.length || homeMissing.length) return { compatible: false,
    update: workerMissing.length && homeMissing.length ? 'both' : workerMissing.length ? 'worker' : 'home',
    reason: `Required capabilities are unavailable: ${[...workerMissing, ...homeMissing].join(', ')}.` };
  return { compatible: true, protocol: Math.max(...common), capabilities: home.capabilities.filter(c => worker.capabilities.includes(c)) };
}
export function compatibilityMessage(result: Extract<CompatibilityResult, { compatible: false }>, deviceName: string, homeName: string): string {
  const target = result.update === 'home' ? homeName : result.update === 'worker' ? deviceName : `${homeName} and ${deviceName}`;
  return `Update Ri on ${target}. ${result.reason} Existing work and enrollment are retained.`;
}

/** No format bump is needed for this bridge. Old journals remain format 1.
 * A future release must ship an explicit converter before changing writes. */
export function localFormatReasons(candidate: RuntimeCompatibility, current = CURRENT_COMPATIBILITY): string[] {
  const reasons: string[] = [];
  for (const [name, next, previous] of [
    ['command journal', candidate.journal.commands, current.journal.commands],
    ['event journal', candidate.journal.events, current.journal.events],
    ['local configuration', candidate.config, current.config],
  ] as const) {
    if (!next.read.includes(previous.write)) reasons.push(`The update cannot read this device's ${name} format ${previous.write}. Install a bridge release first.`);
    if (next.write !== previous.write) reasons.push(`The update changes the ${name} format without a qualified migration. Install a bridge release first.`);
  }
  return reasons;
}
