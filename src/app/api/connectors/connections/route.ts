import { NextResponse } from 'next/server';
import { getConnectorRuntime } from '@/lib/connectors/runtime';

export async function GET() {
  const connections = await (await getConnectorRuntime()).listConnections();
  return NextResponse.json({ connections });
}
