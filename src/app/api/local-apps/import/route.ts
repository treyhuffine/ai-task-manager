import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getRequestKey } from '@/lib/auth/request-key';
import { readLimitedFormData } from '@/lib/api/limited-body';
import { getLocalAppsWorkDir } from '@/lib/config/paths';
import { localApps, localAppsEnabled } from '@/lib/local-apps/service';
import { publicError } from '@ri/app-kit/contract';
export async function POST(request: Request) {
  if (!localAppsEnabled()) return Response.json({ error: 'Local apps unavailable' }, { status: 404 });
  if (getRequestKey(request.headers)?.scope !== 'viewer') return Response.json({ error: 'Unauthorized' }, { status: 403 });
  const dir = getLocalAppsWorkDir(), file = path.join(dir, `${randomUUID()}.upload`);
  try { const form = await readLimitedFormData(request), archive = form.get('package'); if (!(archive instanceof File)) return Response.json({ error: 'Select a package archive' }, { status: 400 }); await fs.mkdir(dir, { recursive: true, mode: 0o700 }); await fs.writeFile(file, new Uint8Array(await archive.arrayBuffer()), { mode: 0o600 }); return Response.json(await localApps().import(file)); }
  catch (error) { return Response.json({ error: publicError(error).message }, { status: 400 }); } finally { await fs.rm(file, { force: true }); }
}
