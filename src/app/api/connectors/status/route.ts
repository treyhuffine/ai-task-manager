import { NextResponse } from 'next/server';
import { getProviderStatuses, getConnectorRedirectUri } from '@/lib/connectors/runtime';
import { withCompression } from '@/lib/api/compression';

/** Per-provider connect readiness + how each connects (drives the test page UI). */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  return NextResponse.json({
    redirectUri: getConnectorRedirectUri(),
    providers: await getProviderStatuses(),
  });
}
