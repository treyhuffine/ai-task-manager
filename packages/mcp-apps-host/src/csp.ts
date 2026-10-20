/**
 * A view's Content Security Policy, from the network domains its UI resource
 * declares (docs/connected-mcp-apps.md, "Security"). The view runs in an
 * opaque, sandboxed frame, and that frame is what keeps it apart from Ri: it
 * can't read Ri's page, storage or cookies. The policy only decides where the
 * view may reach on the network: the domains it declared, and nothing else,
 * so a screen can't probe the person's own computer or local network unless
 * it said so, and the connection page lists what each app declared. Scripts
 * run freely inside the frame (inline and `eval`), since nothing they do
 * there reaches Ri.
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

/** The domains a UI resource's `_meta` declares, from either spec, joined. */
export function declaredCsp(meta: unknown): ViewCsp {
  const ui = record(record(record(meta).ui).csp);
  const openai = record(record(meta)["openai/widgetCSP"]);
  return {
    connectDomains: sources(ui.connectDomains, openai.connect_domains),
    resourceDomains: sources(ui.resourceDomains, openai.resource_domains),
    frameDomains: sources(ui.frameDomains, openai.frame_domains),
    baseUriDomains: sources(ui.baseUriDomains),
  };
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
