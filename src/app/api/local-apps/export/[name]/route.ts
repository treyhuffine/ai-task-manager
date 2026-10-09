import fs from 'node:fs/promises';
import path from 'node:path';
import { getRequestKey } from '@/lib/auth/request-key';
import { getLocalAppsWorkDir } from '@/lib/config/paths';
import { localAppsEnabled } from '@/lib/local-apps/service';
export async function GET(request: Request, context: { params: Promise<{ name: string }> }) {
  if (!localAppsEnabled()) return new Response(null, { status: 404 });
  if (getRequestKey(request.headers)?.scope !== 'viewer') return new Response(null, { status: 403 });
  const { name } = await context.params; if (!/^[0-9a-f-]{36}\.tar\.gz$/.test(name)) return new Response(null, { status: 404 });
  const file = path.join(getLocalAppsWorkDir(), name);
  try { return new Response(await fs.readFile(file), { headers: { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } }); } catch { return new Response(null, { status: 404 }); }
}
