import { NextResponse } from 'next/server';
import { getConnectorRuntime } from '@/lib/connectors/runtime';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  const connections = await (await getConnectorRuntime()).listConnections();
  return NextResponse.json({ connections });
}
