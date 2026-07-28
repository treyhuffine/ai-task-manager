/**
 * Client-safe URL math for the app's beamd tunnel. Pure string work, no node
 * deps, so settings UI can import it directly.
 *
 * Edges differ in how a tunnel name becomes a hostname: flat
 * (`<name>.<domain>`) or account-suffixed (`<name>-<account>.<domain>`, e.g. a
 * `flow-dev` tunnel served at `flow-dev-acme.beamd.run`). Flow never assembles
 * a tunnel URL for real (beamd returns the authoritative one), but to preview a
 * *rename* before opening it we have to reuse whatever shape the current URL is
 * already in.
 */

/**
 * The URL this tunnel would get under `nextName`, inferred from the URL it has
 * now. Returns null when the saved URL isn't recognizably this tunnel (a
 * hand-set Tailscale/ngrok/Cloudflare URL, or an unparseable one) — better no
 * preview than a confidently wrong one.
 */
export function tunnelHostPreview(
  savedUrl: string | null | undefined,
  currentName: string | null | undefined,
  nextName: string | null | undefined,
): string | null {
  if (!savedUrl || !currentName || !nextName) return null;
  let host: string;
  try {
    host = new URL(savedUrl).hostname;
  } catch {
    return null;
  }
  const dot = host.indexOf('.');
  if (dot < 0) return null;
  const label = host.slice(0, dot);
  const domain = host.slice(dot + 1);
  if (label === currentName) return `https://${nextName}.${domain}`;
  if (label.startsWith(`${currentName}-`)) {
    return `https://${nextName}-${label.slice(currentName.length + 1)}.${domain}`;
  }
  return null;
}
