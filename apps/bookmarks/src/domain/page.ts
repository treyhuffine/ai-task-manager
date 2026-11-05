/** What a saved page says, from its HTML or text. Bounded, and never trusted as instructions. */
import { htmlToText } from "@ri/app-kit/sources";

export const MAX_PAGE_CHARS = 200_000;
export const MAX_EXCERPT = 280;

export interface PageContent {
  title: string | null;
  excerpt: string | null;
  text: string;
}

function meta(html: string, name: string): string | null {
  const escaped = name.replace(":", "\\:");
  const forward = new RegExp(`<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(html);
  const backward = forward ?? new RegExp(`<meta\\b[^>]*content\\s*=\\s*(?:"([^"]*)"|'([^']*)')[^>]*(?:name|property)\\s*=\\s*["']${escaped}["']`, "i").exec(html);
  return backward ? (backward[1] ?? backward[2] ?? null) : null;
}
const oneLine = (text: string | null | undefined) => {
  const value = htmlToText(text ?? "").replace(/\s+/g, " ").trim();
  return value || null;
};

/** Page furniture says nothing about the page. */
const FURNITURE = /<(script|style|noscript|svg|template|iframe|nav|header|footer|aside|form|button|select)\b[\s\S]*?<\/\1\s*>/gi;
const LARGEST_BLOCK = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;

export function clipText(text: string): string {
  return text.length <= MAX_PAGE_CHARS ? text : text.slice(0, MAX_PAGE_CHARS);
}
export function excerptOf(text: string): string | null {
  // List markers from the text form don't belong in one flowing line.
  const flat = text.replace(/^\s*-\s+/gm, "").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= MAX_EXCERPT) return flat;
  const cut = flat.slice(0, MAX_EXCERPT - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > MAX_EXCERPT / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function readHtml(html: string): PageContent {
  const head = html.slice(0, 200_000);
  const title = oneLine(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1]) ?? oneLine(meta(head, "og:title"));
  const description = oneLine(meta(head, "description")) ?? oneLine(meta(head, "og:description"));
  const clean = html.replace(/<!--[\s\S]*?-->/g, " ").replace(FURNITURE, " ");
  // A long enough article or main is the page. Otherwise take everything left.
  let best: string | null = null;
  for (const match of clean.matchAll(LARGEST_BLOCK)) if (!best || match[2].length > best.length) best = match[2];
  const fromBlock = best ? htmlToText(best) : "";
  const text = clipText(fromBlock.length >= 280 ? fromBlock : htmlToText(clean));
  return { title: title?.slice(0, 500) ?? null, excerpt: excerptOf(description ?? text), text };
}

export function readPlainText(text: string): PageContent {
  const clean = clipText(text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim());
  return { title: null, excerpt: excerptOf(clean), text: clean };
}
