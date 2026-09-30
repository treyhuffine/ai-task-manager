/** Home-only compatibility inventory. Authenticated heartbeats update it.
 * Kept across Home restarts so an offline worker never becomes falsely idle. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getConfigDir } from '@/lib/config/paths';
import { atomicWriteFile } from '@/lib/config/atomic-file';
import { listDevices, listEnrolledDeviceIds, getWorkerKeyId, listWorkerCommands, deliveredSendsWithOpenRuns } from '@/lib/db/queries';
import { compatibilityMessage, PeerReleaseSchema, legacyCompatibility, negotiateWorker, type PeerRelease, type RuntimeCompatibility } from '@/lib/releases/compatibility';
import { runtimePeerRelease, readRuntimeCompatibility } from '@/lib/releases/runtime-identity';

export const WorkerJournalReportSchema = z.object({ pendingEvents: z.number().int().nonnegative(), pendingCommands: z.number().int().nonnegative(), openTurns: z.number().int().nonnegative(), lastEvent: z.number().int().nonnegative() }).strict();
const reportSchema = z.object({ keyId: z.string(), at: z.string(), peer: PeerReleaseSchema.optional(), protocol: z.number().int().optional(), journal: WorkerJournalReportSchema.optional(), stopped: z.boolean() }).strict();
function reportPath(deviceId: string) { return path.join(getConfigDir(), 'worker-compatibility', `${createHash('sha256').update(deviceId).digest('hex')}.json`); }
export function recordWorkerCompatibility(deviceId: string, keyId: string, peer: PeerRelease | undefined, journal: z.infer<typeof WorkerJournalReportSchema> | undefined, stopped: boolean, protocol?: number) {
  atomicWriteFile(reportPath(deviceId), JSON.stringify({ keyId, peer, protocol, journal, stopped, at: new Date().toISOString() }));
}
function readReport(deviceId: string, keyId: string) {
  try {
    const report = reportSchema.parse(JSON.parse(fs.readFileSync(reportPath(deviceId), 'utf8')));
    return report.keyId === keyId ? report : null;
  } catch { return null; } // Missing/corrupt/old-enrollment evidence is unknown, never idle.
}
export function homeCompatibilityReasons(candidate: RuntimeCompatibility | null): string[] {
  const enrolled = listEnrolledDeviceIds();
  if (!enrolled.size) return [];
  if (!candidate) return ['This release has no worker compatibility metadata. Install a bridge release before updating a Home with enrolled devices.'];
  const reasons: string[] = [];
  for (const device of listDevices()) {
    if (!enrolled.has(device.id)) continue;
    const report = readReport(device.id, getWorkerKeyId(device.id)!);
    const compatibility = report?.peer?.compatibility ?? legacyCompatibility(report?.protocol ?? device.workerProtocol ?? 0);
    if (negotiateWorker(candidate, compatibility).compatible) continue;
    const unresolved = listWorkerCommands(device.id, { states: ['sent', 'uncertain'] }).length + deliveredSendsWithOpenRuns(device.id).length;
    // A last stopped report with no undelivered work is the only proof an
    // incompatible offline device cannot still be producing old-format events.
    const journal = report?.journal;
    const safelyStopped = report?.stopped && journal && !journal.pendingEvents && !journal.pendingCommands && !journal.openTurns;
    if (unresolved || !safelyStopped) reasons.push(`Update ${device.name} through a compatible bridge first. Its current or undelivered work cannot be discarded for this Home update.`);
  }
  return reasons;
}
export function homeUpdateCompatibility(repo: string): string[] { return homeCompatibilityReasons(readRuntimeCompatibility(repo)); }

/** Public display data contains neither enrollment keys nor paths. */
export function workerCompatibilityView(deviceId: string, deviceName: string, protocol: number | null) {
  const key = getWorkerKeyId(deviceId);
  if (!key) return undefined;
  const report = readReport(deviceId, key);
  if (!report && protocol === null) return { state: 'unknown' as const, capabilities: [] as string[] };
  const agreement = negotiateWorker(runtimePeerRelease().compatibility, report?.peer?.compatibility ?? legacyCompatibility(report?.protocol ?? protocol ?? 0));
  return {
    state: agreement.compatible ? 'compatible' as const : 'update-required' as const,
    release: report?.peer?.release, reportedAt: report?.at,
    protocol: agreement.compatible ? agreement.protocol : undefined,
    capabilities: agreement.compatible ? agreement.capabilities : [],
    update: agreement.compatible ? undefined : agreement.update,
    reason: agreement.compatible ? undefined : compatibilityMessage(agreement, deviceName, 'your Home'),
    pendingEvents: report?.journal?.pendingEvents,
    pendingCommands: report?.journal?.pendingCommands,
    openTurns: report?.journal?.openTurns,
  };
}
