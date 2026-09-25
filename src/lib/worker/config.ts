/**
 * This computer's worker enrollment (docs/homes-build.md, P2.2): the worker
 * key its home issued, and which home and computer it's for. Kept in
 * `<configDir>/worker.json`, 0600, machine-local and never backed up. The
 * home's address comes from the connection record beside it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getWorkerConfigPath } from '@/lib/config/paths';

export const WORKER_CONFIG_VERSION = 1;

export interface WorkerConfig {
  version: number;
  homeId: string;
  computerId: string;
  computerName: string;
  workerKey: string;
  enrolledAt: string;
}

export function readWorkerConfig(): WorkerConfig | null {
  const file = getWorkerConfigPath();
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<WorkerConfig>;
  if (
    parsed.version !== WORKER_CONFIG_VERSION ||
    typeof parsed.homeId !== 'string' ||
    typeof parsed.computerId !== 'string' ||
    typeof parsed.workerKey !== 'string'
  ) {
    throw new Error(`${file} is not a worker enrollment this version of Ri can read. Enroll again with \`ri worker enroll\`.`);
  }
  return {
    version: WORKER_CONFIG_VERSION,
    homeId: parsed.homeId,
    computerId: parsed.computerId,
    computerName: parsed.computerName ?? 'this computer',
    workerKey: parsed.workerKey,
    enrolledAt: parsed.enrolledAt ?? '',
  };
}

export function writeWorkerConfig(config: Omit<WorkerConfig, 'version'>): WorkerConfig {
  const file = getWorkerConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const full: WorkerConfig = { version: WORKER_CONFIG_VERSION, ...config };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(full, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  return full;
}

export function removeWorkerConfig(): boolean {
  const file = getWorkerConfigPath();
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}
