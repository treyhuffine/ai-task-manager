import { NextResponse } from 'next/server';
import { getProviderStatuses, getConnectorRedirectUri } from '@/lib/connectors/runtime';

/** Per-provider connect readiness + how each connects (drives the test page UI). */
export async function GET() {
  return NextResponse.json({
    redirectUri: getConnectorRedirectUri(),
    providers: await getProviderStatuses(),
  });
}
