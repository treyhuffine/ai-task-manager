import { NextRequest, NextResponse } from 'next/server';
import { getNotificationChannel, updateNotificationChannel, deleteNotificationChannel } from '@/lib/db/queries';
import { getNotifierUserId } from '@/lib/notifications/user';
import { MATRIX_EVENT_TYPES } from '@/lib/notifications/events';

/** PATCH → toggle events / enabled / config. DELETE → remove (scrubs trigger bindings). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = getNotificationChannel(id);
  if (!existing || existing.userId !== getNotifierUserId()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as {
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
  return NextResponse.json({ channel });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = getNotificationChannel(id);
  if (!existing || existing.userId !== getNotifierUserId()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  deleteNotificationChannel(id);
  return NextResponse.json({ ok: true });
}
