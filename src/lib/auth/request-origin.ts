/** Cookie authority is ambient. Unsafe requests must prove their exact origin,
 * including port. Explicit bearer clients do not use ambient authority. */
export function permitsCookieMutation(request: Request): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return true;
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ') && authorization.slice(7).trim()) return true;
  const origin = request.headers.get('origin');
  if (!origin) return request.headers.get('sec-fetch-site') === 'same-origin';
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) return false;
    const target = new URL(request.url);
    // Our HTTPS gateway and remote TLS terminators preserve Host. Do not
    // accept a client-supplied x-forwarded-host as an extra allowed origin.
    const host = request.headers.get('host') ?? target.host;
    const forwardedProtocol = request.headers.get('x-forwarded-proto');
    const protocol = forwardedProtocol === 'https' ? 'https:' : target.protocol;
    return parsed.host === host && parsed.protocol === protocol;
  } catch {
    return false;
  }
}
