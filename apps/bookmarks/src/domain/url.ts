/**
 * Links as records. `url` is what opens. `key` is what two saves of the same
 * page have in common, so a repeat merges instead of making a second record.
 */
const TRACKING = /^(utm_[a-z_]+|fbclid|gclid|gbraid|wbraid|dclid|msclkid|yclid|twclid|igshid|igsh|mc_cid|mc_eid|_hsenc|_hsmi|mkt_tok|vero_id|oly_anon_id|oly_enc_id|rb_clickid|s_cid|ncid)$/i;

export interface ParsedLink {
  url: string;
  key: string;
  site: string;
}

/** The link as a record, or null when it is not a saveable http or https address. */
export function parseLink(raw: string): ParsedLink | null {
  const text = raw.trim();
  if (!text || text.length > 4096) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // A link with a password in it should not be stored or requested.
  if (url.username || url.password || !url.hostname) return null;
  return { url: url.href, key: linkKey(url), site: url.hostname.replace(/^www\./, "") };
}

function linkKey(url: URL): string {
  const copy = new URL(url.href);
  // Keep a fragment only when it is the page's route.
  if (!/^#[/!]/.test(copy.hash)) copy.hash = "";
  for (const name of [...copy.searchParams.keys()]) if (TRACKING.test(name)) copy.searchParams.delete(name);
  const path = copy.pathname.length > 1 ? copy.pathname.replace(/\/+$/, "") : "";
  // URL has already lower-cased the scheme and host and dropped a default port.
  return `${copy.protocol}//${copy.host}${path}${copy.search}${copy.hash}`;
}

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;
export function cleanTag(raw: string): string | null {
  const tag = raw.normalize("NFKC").replace(/^#+/, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, MAX_TAG_LENGTH).trim();
  return tag || null;
}
export function cleanTags(raw: readonly string[]): string[] {
  const out = new Set<string>();
  for (const item of raw) {
    const tag = cleanTag(item);
    if (tag) out.add(tag);
    if (out.size >= MAX_TAGS) break;
  }
  return [...out];
}

/** A valid instant as an ISO string, from an ISO date or an epoch in seconds, milliseconds or microseconds. */
export function parseSavedAt(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const text = String(raw).trim();
  let time: number;
  if (/^\d+$/.test(text)) {
    const value = Number(text);
    time = value > 1e14 ? value / 1000 : value > 1e11 ? value : value * 1000;
  } else time = Date.parse(text);
  if (!Number.isFinite(time) || time <= 0) return null;
  const date = new Date(time);
  // Before the web, or after now plus a day, is a bad value rather than a date.
  if (date.getUTCFullYear() < 1990 || time > Date.now() + 86_400_000) return null;
  return date.toISOString();
}
