import { X509Certificate } from 'node:crypto';

/** Electron's verifier has a hostname, but no port. The pin is session-scoped. */
export function certificateDecision(hostname: string, pem: string, expected: { origin: string; certificate: string }, now = Date.now()): 0 | -2 | -3 {
  const host = new URL(expected.origin).hostname;
  if (hostname !== host) return -3; // Chromium's normal validation for every other host.
  try {
    const cert = new X509Certificate(pem);
    const pin = new X509Certificate(expected.certificate);
    const from = Date.parse(cert.validFrom);
    const to = Date.parse(cert.validTo);
    const matchesHost = host === '127.0.0.1' ? !!cert.checkIP(host) : !!cert.checkHost(host);
    return cert.raw.equals(pin.raw) && matchesHost && Number.isFinite(from) && Number.isFinite(to) && now >= from && now <= to ? 0 : -2;
  } catch {
    return -2;
  }
}

export function sameOrigin(url: string, origin: string): boolean {
  try { return new URL(url).origin === origin; } catch { return false; }
}

/** Strip caller-supplied capabilities before admitting our main frame or an
 * explicitly authenticated main-process request. Subframes never inherit it. */
export function desktopRequestHeaders(input: {
  headers: Record<string, string>; url: string; origin: string; capability?: string;
  nativeRequest: boolean; trustedMainFrame: boolean;
}): Record<string, string> {
  const headers = { ...input.headers };
  const presented = Object.entries(headers).filter(([key]) => key.toLowerCase() === 'x-ri-desktop-client');
  for (const [key] of presented) delete headers[key];
  if (input.capability && sameOrigin(input.url, input.origin) && (input.trustedMainFrame ||
    (input.nativeRequest && presented.length === 1 && presented[0][1] === input.capability))) {
    headers['x-ri-desktop-client'] = input.capability;
  }
  return headers;
}

export function externalWebUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
