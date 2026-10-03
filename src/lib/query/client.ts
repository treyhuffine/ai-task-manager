import { isServer, QueryClient } from '@tanstack/react-query';

export function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true } } });
}
let browserClient: QueryClient | undefined;
export function getQueryClient() {
  // No shared cache between server requests. The browser has one page cache,
  // also used by tRPC's options factory outside React.
  if (isServer) return makeQueryClient();
  return browserClient ??= makeQueryClient();
}
