/**
 * A view's Content Security Policy, from the network domains its UI resource
 * declares (docs/connected-mcp-apps.md, "Security"). The view runs in an
 * opaque, sandboxed frame, and that frame is what keeps it apart from Ri: it
 * can't read Ri's page, storage or cookies. The policy only decides where the
 * view may reach on the network: the domains it declared, and nothing else,
 * and the connection page lists what each app declared. A remote app's
 * screen never reaches the person's own computer or local network, even if
 * it declares an address there (`KEEP_REMOTE_APPS_OFF_THE_LOCAL_NETWORK`).
 * Scripts run freely inside the frame (inline and `eval`), since nothing
 * they do there reaches Ri.
 *
 * Declarations come from the MCP Apps spec (`_meta.ui.csp`: `connectDomains`,
 * `resourceDomains`, `frameDomains`, `baseUriDomains`) and from OpenAI's
 * (`_meta["openai/widgetCSP"]`: `connect_domains`, `resource_domains`,
 * `frame_domains`). Both are read and joined.
 */
export interface ViewCsp {
  /** Where the view may `fetch`, open WebSockets and the like (`connect-src`). */
  connectDomains: string[];
  /** Where its scripts, styles, images, fonts, media and workers may load from. */
  resourceDomains: string[];
  /** What it may show in frames of its own (`frame-src`). */
  frameDomains: string[];
  /** What its `<base>` may name (`base-uri`). */
  baseUriDomains: string[];
}

export const NO_NETWORK: ViewCsp = { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] };

/** What a UI resource declared: the domains its screen may reach, and those Ri left out (`blocked`). */
export interface DeclaredNetwork extends ViewCsp {
  /** Declared domains on the person's computer or local network, left out for a remote app. */
  blocked: string[];
}

/**
 * The switch for the one rule about local addresses (docs/connected-mcp-apps.md,
 * "Security"). While true, a screen from a remote app can't reach localhost,
 * loopback, `.local` names, private or link-local IPv4 and IPv6 ranges, or the
 * IPv6 loopback, even when it declares them: a remote app has no business on
 * the person's own network, and it is where unauthenticated services live. An
 * app whose server runs on this computer keeps them, since that is where it
 * lives. Set false to let every app reach the local addresses it declares.
 * A public name that resolves to a private address isn't caught here: that is
 * left to the browser.
 */
export const KEEP_REMOTE_APPS_OFF_THE_LOCAL_NETWORK = true;

const ipv4 = (host: string) => {
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)?.slice(1).map(Number);
  return parts && parts.every(part => part <= 255) ? parts : null;
};
const privateIpv4 = ([a, b]: number[]) =>
  a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);

/** Whether a CSP source (`scheme://host[:port]`) names the person's computer or local network. */
export function isLocalNetworkSource(source: string): boolean {
  const host = /^[a-z]+:\/\/(\[[^\]]+\]|[^:/]+)/i.exec(source)?.[1]?.toLowerCase();
  if (!host) return false;
  const name = host.replace(/^\*\./, "");
  if (name === "localhost" || name.endsWith(".localhost") || name === "local" || name.endsWith(".local")) return true;
  const v4 = ipv4(name);
  if (v4) return privateIpv4(v4);
  if (!host.startsWith("[")) return false;
  const v6 = host.slice(1, -1);
  // Loopback and unspecified, unique-local (fc00::/7), link-local (fe80::/10), and IPv4 mapped into IPv6.
  if (v6 === "::1" || v6 === "::") return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(v6) || /^fe[89ab][0-9a-f]?:/.test(v6)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6)?.[1];
  return !!mapped && !!ipv4(mapped) && privateIpv4(ipv4(mapped)!);
}

const ORIGIN = /^(https?|wss?):\/\/((?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(:\d{1,5})?(?:\/.*)?$/i;

/**
 * One declared domain as a CSP source: its scheme, host (a leading `*.` for
 * subdomains) and port. A path is dropped, so the whole origin is allowed.
 * Anything else (a bare `*`, a keyword, a space or `;` that would add to the
 * policy) is not a domain and is left out.
 */
export function cspSource(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ORIGIN.exec(value.trim());
  if (!match) return null;
  return `${match[1]}://${match[2]}${match[3] ?? ""}`.toLowerCase();
}

const sources = (...lists: unknown[]) => {
  const out = new Set<string>();
  for (const list of lists) if (Array.isArray(list)) for (const item of list) { const source = cspSource(item); if (source) out.add(source); }
  return [...out];
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/**
 * The domains a UI resource's `_meta` declares, from either spec, joined.
 * For a remote app (`serverIsLocal` false), local addresses are left out and
 * named in `blocked` (`KEEP_REMOTE_APPS_OFF_THE_LOCAL_NETWORK`).
 */
export function declaredCsp(meta: unknown, options: { serverIsLocal?: boolean } = {}): DeclaredNetwork {
  const ui = record(record(record(meta).ui).csp);
  const openai = record(record(meta)["openai/widgetCSP"]);
  const blocked = new Set<string>();
  const keep = (list: string[]) => list.filter(source => {
    if (!KEEP_REMOTE_APPS_OFF_THE_LOCAL_NETWORK || options.serverIsLocal || !isLocalNetworkSource(source)) return true;
    blocked.add(source);
    return false;
  });
  const network = {
    connectDomains: keep(sources(ui.connectDomains, openai.connect_domains)),
    resourceDomains: keep(sources(ui.resourceDomains, openai.resource_domains)),
    frameDomains: keep(sources(ui.frameDomains, openai.frame_domains)),
    baseUriDomains: keep(sources(ui.baseUriDomains)),
  };
  return { ...network, blocked: [...blocked] };
}

/** Whether a view declared any network at all. */
export const declaresNetwork = (csp: ViewCsp) =>
  csp.connectDomains.length + csp.resourceDomains.length + csp.frameDomains.length + csp.baseUriDomains.length > 0;

/**
 * The policy for a view's frames (the relay and the view itself, which
 * inherits its parent's). Everything local is allowed: inline scripts,
 * `eval`, WebAssembly, `data:` and `blob:` images, fonts, media and workers.
 * Everything on the network is refused except the declared domains. Forms
 * never submit (`form-action 'none'`).
 */
export function viewPolicy(csp: ViewCsp = NO_NETWORK): string {
  const resource = csp.resourceDomains.join(" ");
  const or = (list: string[]) => list.length ? list.join(" ") : "'none'";
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data: ${resource}`,
    `style-src 'unsafe-inline' blob: data: ${resource}`,
    `img-src blob: data: ${resource}`,
    `font-src blob: data: ${resource}`,
    `media-src blob: data: ${resource}`,
    `worker-src blob: ${resource}`,
    `connect-src ${or(csp.connectDomains)}`,
    `frame-src ${or(csp.frameDomains)}`,
    `base-uri ${or(csp.baseUriDomains)}`,
    "object-src 'none'",
    "form-action 'none'",
  ].map(part => part.trim()).join("; ");
}
