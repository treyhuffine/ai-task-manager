/**
 * Perf-log labels for HTTP requests: one per route, not per record, so the
 * rollup counts `GET /api/sessions/:id/events` rather than a line per chat.
 */

/** A segment that names a record: a number, or a long token with a digit (UUIDs, ULIDs, attachment file names). */
const ID_SEGMENT = /^(?:\d+|(?=[^/]*\d)[\w.~-]{12,})$/;

export function requestLabel(method: string | undefined, pathname: string): string {
  const verb = method ?? 'GET';
  // tRPC names its procedure in the path, `/api/trpc/tasks.list`, or several
  // comma-separated for a batch from an older client.
  if (pathname.startsWith('/api/trpc/')) return `trpc:${safeDecode(pathname.slice('/api/trpc/'.length))}`;
  if (pathname.startsWith('/_next/')) return `http:${verb} /_next/*`;
  const route = pathname
    .split('/')
    .map((segment) => (ID_SEGMENT.test(segment) ? ':id' : segment))
    .join('/');
  return `http:${verb} ${route || '/'}`;
}

/** A tRPC procedure, as the WebSocket path and the middleware name it. */
export function procedureLabel(path: string): string {
  return `trpc:${path}`;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
