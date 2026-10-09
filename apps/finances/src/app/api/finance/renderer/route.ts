import {
  financeRendererHtml,
  financeRendererPolicy,
} from '@/lib/finance/renderer';
export const runtime = 'nodejs';
export function GET() {
  return new Response(financeRendererHtml(), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': financeRendererPolicy(),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
