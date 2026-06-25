import { NextRequest, NextResponse } from 'next/server';
import { listNotificationChannels, createNotificationChannel } from '@/lib/db/queries';
import { getNotifierUserId } from '@/lib/notifications/user';
import { defaultChannelEvents, MATRIX_EVENT_TYPES } from '@/lib/notifications/events';

/** GET → this user's notification channels. POST → create one (Telegram connector for v1). */
export function GET() {
  return NextResponse.json({ channels: listNotificationChannels({ userId: getNotifierUserId() }) });
}

export async function POST(request: NextRequest) {
  const userId = getNotifierUserId();
  const body = (await request.json().catch(() => ({}))) as {
    kind?: 'connector' | 'web_push';
    providerId?: string;
    connectionId?: string;
    label?: string;
    config?: Record<string, unknown>;
    events?: string[];
  };
  if (body.kind !== 'connector') {
    // web_push channels are created via the subscribe flow; only connector channels are added here.
    return NextResponse.json({ error: "kind must be 'connector'" }, { status: 400 });
  }
  if (body.providerId !== 'telegram') {
    return NextResponse.json({ error: 'unsupported providerId (telegram only in v1)' }, { status: 400 });
  }
  if (!body.connectionId) return NextResponse.json({ error: 'connectionId required' }, { status: 400 });
  const chatId = (body.config as { chatId?: unknown } | undefined)?.chatId;
  if (chatId === undefined || chatId === null || chatId === '') {
    return NextResponse.json({ error: 'config.chatId required' }, { status: 400 });
  }
  const events = (body.events ?? defaultChannelEvents()).filter((e) => (MATRIX_EVENT_TYPES as readonly string[]).includes(e));

  const channel = createNotificationChannel({
    userId,
    kind: 'connector',
    providerId: 'telegram',
    connectionId: body.connectionId,
    ...(body.label?.trim() ? { label: body.label.trim() } : {}),
    config: { chatId },
    events,
    enabled: true,
  });
  return NextResponse.json({ channel }, { status: 201 });
}
