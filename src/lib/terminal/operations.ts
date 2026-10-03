import { answerResult, failure, reply } from '@/lib/server/operation';
import { terminalDescriptorSchema } from '@/lib/server/remote-contracts';
import { z } from 'zod/v4';
import type { TerminalPlace } from './place';
import { createTerminal, getTerminal, killTerminal, listTerminals, resizeTerminal, TerminalSpawnError, writeInput } from './pty-manager';
import { askTerminal } from './remote';

export const terminalDimensions = z.object({ cols: z.number().int().positive().optional(), rows: z.number().int().positive().optional() }).strict();
export const terminalInput = z.object({ data: z.string() }).strict();
export const terminalResize = z.object({ cols: z.number().int().positive(), rows: z.number().int().positive() }).strict();
const changed = z.object({ ok: z.literal(true) });
function refuse(place: { error: string; status: number }) { return failure({ error: place.error }, place.status); }

export async function listTerminalsResult(place: TerminalPlace) {
  if (place.at === 'nowhere') return refuse(place);
  if (place.at === 'elsewhere') {
    const result = answerResult(await askTerminal(place, { op: 'list', scope: place.scope }), z.array(terminalDescriptorSchema));
    return result.ok ? reply(result.data.map(row => ({ ...row, ...place.location }))) : result;
  }
  if (!place.owner.ok) return refuse(place.owner);
  return reply(listTerminals(place.owner.ownerId).map(row => ({ ...row, ...place.location })));
}
export async function createTerminalResult(body: z.infer<typeof terminalDimensions>, place: TerminalPlace, logTag: string) {
  if (place.at === 'nowhere') return refuse(place);
  const cols = Number.isFinite(body.cols) && body.cols! > 0 ? Math.floor(body.cols!) : 80;
  const rows = Number.isFinite(body.rows) && body.rows! > 0 ? Math.floor(body.rows!) : 24;
  if (place.at === 'elsewhere') {
    if (place.refuseCreate) return failure({ error: place.refuseCreate }, 409);
    const result = answerResult(await askTerminal(place, { op: 'create', scope: place.scope, cols, rows }), terminalDescriptorSchema);
    return result.ok ? reply({ ...result.data, ...place.location }, { status: 201 }) : result;
  }
  const cwd = place.cwd();
  if (!cwd.ok) return refuse(cwd);
  try { return reply({ ...createTerminal({ ownerId: cwd.ownerId, cwd: cwd.cwd, cols, rows }), ...place.location }, { status: 201 }); }
  catch (err) {
    const isSpawn = err instanceof Error && (err.name === 'TerminalSpawnError' || err instanceof TerminalSpawnError);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${logTag} spawn failed:`, message);
    return failure({ error: message, ...(isSpawn ? { code: (err as TerminalSpawnError).code ?? 'spawn_failed' } : {}) }, isSpawn && (err as TerminalSpawnError).code !== 'spawn_failed' ? 409 : 500);
  }
}
export async function getTerminalResult(place: TerminalPlace, terminalId: string) {
  if (place.at === 'nowhere') return refuse(place);
  if (place.at === 'elsewhere') {
    const result = answerResult(await askTerminal(place, { op: 'get', scope: place.scope, terminalId }), terminalDescriptorSchema);
    return result.ok ? reply({ ...result.data, ...place.location }) : result;
  }
  if (!place.owner.ok) return refuse(place.owner);
  const value = getTerminal(place.owner.ownerId, terminalId);
  return value ? reply({ ...value, ...place.location }) : failure({ error: 'Terminal not found' }, 404);
}
export async function deleteTerminalResult(place: TerminalPlace, terminalId: string) {
  if (place.at === 'nowhere') return refuse(place);
  if (place.at === 'elsewhere') return answerResult(await askTerminal(place, { op: 'close', scope: place.scope, terminalId }), changed);
  if (!place.owner.ok) return refuse(place.owner);
  return killTerminal(place.owner.ownerId, terminalId) ? reply({ ok: true }) : failure({ error: 'Terminal not found' }, 404);
}
export async function terminalInputResult(body: z.infer<typeof terminalInput>, place: TerminalPlace, terminalId: string, onInput?: () => void) {
  if (typeof body?.data !== 'string') return failure({ error: 'data must be a string' }, 400);
  if (place.at === 'nowhere') return refuse(place);
  if (place.at === 'elsewhere') {
    const result = answerResult(await askTerminal(place, { op: 'input', scope: place.scope, terminalId, data: body.data }), changed);
    if (result.ok) onInput?.();
    return result;
  }
  if (!place.owner.ok) return refuse(place.owner);
  if (!writeInput(place.owner.ownerId, terminalId, body.data)) return failure({ error: 'Terminal not found or exited' }, 404);
  onInput?.();
  return reply({ ok: true });
}
export async function terminalResizeResult(body: z.infer<typeof terminalResize>, place: TerminalPlace, terminalId: string) {
  if (!Number.isFinite(body?.cols) || !Number.isFinite(body?.rows) || body.cols < 1 || body.rows < 1) return failure({ error: 'cols and rows must be positive numbers' }, 400);
  if (place.at === 'nowhere') return refuse(place);
  const cols = Math.floor(body.cols), rows = Math.floor(body.rows);
  if (place.at === 'elsewhere') return answerResult(await askTerminal(place, { op: 'resize', scope: place.scope, terminalId, cols, rows }), changed);
  if (!place.owner.ok) return refuse(place.owner);
  return resizeTerminal(place.owner.ownerId, terminalId, cols, rows) ? reply({ ok: true }) : failure({ error: 'Terminal not found or exited' }, 404);
}
