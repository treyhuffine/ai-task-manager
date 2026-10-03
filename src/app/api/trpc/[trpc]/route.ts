import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { withCompression } from '@/lib/api/compression';
import { appRouter } from '@/lib/trpc/router';
import { createTRPCContext } from '@/lib/trpc/init';

export const runtime = 'nodejs';
const handler = withCompression((req: Request) => fetchRequestHandler({
  endpoint: '/api/trpc', req, router: appRouter,
  createContext: () => createTRPCContext(req),
  responseMeta: () => ({ headers: { 'Cache-Control': 'no-store' } }),
}));
export { handler as GET, handler as POST };
