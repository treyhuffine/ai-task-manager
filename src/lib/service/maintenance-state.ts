/** Read-only admission state. Safe for workers: no SQLite or Home DB imports. */
import fs from 'node:fs';
import { canonical } from './paths';
import { getDbPath } from '@/lib/config/paths';

export interface MaintenanceGate { phase: 'draining' | 'offline'; token: string; startedAt: string }
export function gatePath(database = getDbPath()) { return `${canonical(database)}.maintenance.json`; }
export function readMaintenance(database?: string): MaintenanceGate | null {
  try { return JSON.parse(fs.readFileSync(gatePath(database), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export class MaintenanceError extends Error {
  constructor() { super('Ri is preparing an update. Please retry shortly.'); this.name = 'MaintenanceError'; }
}
