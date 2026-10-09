import { processFinanceWebhook } from '@/lib/finance/webhooks';
export async function POST(request: Request) {
  try {
    const header = request.headers.get('plaid-verification');
    if (!header) return new Response(null, { status: 401 });
    const size = Number(request.headers.get('content-length'));
    if (size > 1024 * 1024) return new Response(null, { status: 413 });
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400 });
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 1024 * 1024) {
        await reader.cancel();
        return new Response(null, { status: 413 });
      }
      chunks.push(part.value);
    }
    const bytes = Buffer.concat(chunks);
    await processFinanceWebhook(bytes, header);
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 401 });
  }
}
