import { operationResponse } from '@/lib/server/operation';
import { POSTInput, POST as pick } from '@/lib/server/operations/fs/pick-folder';
export async function POST(request: Request) {
  const parsed = POSTInput.safeParse({ body: await request.json().catch(() => ({})) });
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const result = await pick(parsed.data, { headers: request.headers, url: request.url, nextUrl: new URL(request.url), signal: request.signal });
  if (!result.ok) return operationResponse(result);
  if (result.data.kind === 'cancelled') return new Response(null, { status: 204 });
  if (result.data.kind === 'unsupported') return Response.json({ error: result.data.reason }, { status: 501 });
  return Response.json({ path: result.data.path });
}
