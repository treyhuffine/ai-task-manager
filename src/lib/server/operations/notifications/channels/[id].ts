import { deleteNotificationChannel, getNotificationChannel, updateNotificationChannel } from '@/lib/db/queries';
import { MATRIX_EVENT_TYPES } from '@/lib/notifications/events';
import { getNotifierUserId } from '@/lib/notifications/user';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/** PATCH → toggle events / enabled / config. DELETE → remove (scrubs trigger bindings). */
export async function PATCH(rpcInput: rpcZ.infer<typeof PATCHInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const existing = getNotificationChannel(id);
  if (!existing || existing.userId !== getNotifierUserId()) {
    return reply({ error: 'not_found' }, { status: 404 });
  }
  const body = (rpcInput.body) as {
    events?: string[];
    enabled?: boolean;
    config?: Record<string, unknown>;
    label?: string;
  };
  const patch: { events?: string[]; enabled?: boolean; config?: Record<string, unknown>; label?: string | null } = {};
  if (body.events) patch.events = body.events.filter((e) => (MATRIX_EVENT_TYPES as readonly string[]).includes(e));
  if (body.enabled !== undefined) patch.enabled = body.enabled;
  if (body.config) patch.config = body.config;
  if (body.label !== undefined) patch.label = body.label.trim() || null; // empty clears it
  const channel = updateNotificationChannel(id, patch);
  return reply({ channel });
}

export async function DELETE(rpcInput: rpcZ.infer<typeof DELETEInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const existing = getNotificationChannel(id);
  if (!existing || existing.userId !== getNotifierUserId()) {
    return reply({ error: 'not_found' }, { status: 404 });
  }
  deleteNotificationChannel(id);
  return reply({ ok: true });
}

export const PATCHInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "events": rpcZ.array(rpcZ.string()).optional(), "enabled": rpcZ.boolean().optional(), "config": rpcZ.record(rpcZ.string(), rpcZ.record(rpcZ.string(), rpcZ.json())).optional(), "label": rpcZ.string().optional() }).strict().default({}) }).strict();
export const DELETEInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
