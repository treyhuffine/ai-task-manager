import type { DeviceType } from '@/db/types';

/**
 * Best-effort UA → DeviceType mapping. Not a full UA parser — just enough to
 * default the label when a remote device pairs.
 */
export function deviceTypeFromUserAgent(ua: string | null | undefined): DeviceType {
  if (!ua) return 'other';
  const s = ua.toLowerCase();

  if (/\b(curl|wget|httpie|node-fetch|undici|python-requests|go-http-client)\b/.test(s)) {
    return 'service';
  }
  if (/ipad|tablet|kindle|playbook|silk/.test(s)) return 'tablet';
  if (/iphone|android.*mobile|phone|ipod/.test(s)) return 'phone';
  if (/android/.test(s)) return 'tablet';
  if (/macintosh|mac os x|linux|cros|x11|windows/.test(s)) return 'computer';
  return 'other';
}
