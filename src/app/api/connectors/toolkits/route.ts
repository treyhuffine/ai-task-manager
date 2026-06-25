import { NextResponse } from 'next/server';
import { getConnectorRuntime } from '@/lib/connectors/runtime';

export async function GET() {
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
