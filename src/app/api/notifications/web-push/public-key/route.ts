import { NextResponse } from 'next/server';
import { getVapidKeys } from '@/lib/notifications/web-push/vapid';

/** The VAPID public key the browser needs to subscribe to push. */
export function GET() {
  return NextResponse.json({ publicKey: getVapidKeys().publicKey });
}
