import { NextResponse } from 'next/server';
import { getConnectorRuntime } from '@/lib/connectors/runtime';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  const runtime = await getConnectorRuntime();
  const toolkits = runtime.getToolkits().map((t) => ({
    id: t.id,
    displayName: t.displayName,
    providerId: t.providerId,
    scopes: t.scopes ?? [],
    actions: t.actions.map((a) => ({
      id: a.id,
      description: a.description,
      mutating: a.mutating ?? false,
      risk: a.risk ?? (a.mutating ? 'medium' : 'low'),
      scopes: a.scopes ?? [],
    })),
  }));
  return NextResponse.json({ toolkits });
}
