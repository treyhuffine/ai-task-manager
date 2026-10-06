import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { isDesktopRequest } from '@/lib/integrations/desktop-oauth';
import { isInstallationOwner } from '@/lib/service/owner-auth';
import { servicePaths } from '@/lib/service/paths';
import { desktopNotificationAction, desktopNotificationStatus } from '@/lib/notifications/desktop-api';

const channelId = () => `desktop:${servicePaths().id}`;
const allowed = (request: NextRequest) => isDesktopRequest(request) && isInstallationOwner(request);
const denied = () => NextResponse.json({ error: 'Use the local owner desktop to manage native notifications.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
export function GET(request: NextRequest) { return allowed(request) ? desktopNotificationStatus(channelId()) : denied(); }
export async function POST(request: NextRequest) { return allowed(request) ? desktopNotificationAction(request, channelId(), () => allowed(request)) : denied(); }
