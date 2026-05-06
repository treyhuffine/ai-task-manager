import { checkGhStatus } from '@/lib/workspaces/gh';

export async function GET() {
  try {
    const status = await checkGhStatus();
    return Response.json(status);
  } catch (err) {
    console.error('[GET /api/gh/status]', err);
    return Response.json({ installed: false, authenticated: false });
  }
}
