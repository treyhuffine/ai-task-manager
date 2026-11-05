/**
 * Bookmark files. Reads the Netscape HTML every browser and Raindrop export,
 * CSV with a url column (Raindrop's, and others like it) and a plain list of
 * links. Parsing is deterministic and keeps going past anything it cannot read.
 */
import { cleanTags, parseLink, parseSavedAt } from "./url.js";

export type ImportFormat = "browser_html" | "csv" | "link_list";
export interface ImportedLink {
  url: string;
  key: string;
  title: string | null;
  note: string | null;
  excerpt: string | null;
  tags: string[];
  savedAt: string | null;
}
export interface ParsedFile {
  format: ImportFormat;
  links: ImportedLink[];
  /** Entries that were not http or https links, such as browser pages and scripts. */
  skipped: number;
  /** Stopped at the limit with more left in the file. */
  truncated: boolean;
}

export const MAX_IMPORT = 50_000;

/** Folder names browsers and services make for you, which say nothing about the links inside. */
const ROOT_FOLDERS = new Set([
  "bookmarks", "bookmarks bar", "bookmarks toolbar", "bookmarks menu", "favorites", "favorites bar", "favourites", "favourites bar",
  "other bookmarks", "other favorites", "mobile bookmarks", "synced bookmarks", "imported", "unsorted", "menu", "toolbar", "unfiled", "personal toolbar folder",
]);
export const isRootFolder = (name: string) => ROOT_FOLDERS.has(name.trim().toLowerCase());
export function tagsFromFolders(folders: readonly string[], extra: readonly string[] = []): string[] {
  return cleanTags([...folders.filter((name) => !isRootFolder(name)), ...extra]);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : " ";
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}
const cleanText = (text: string | null | undefined) => {
  const value = decodeEntities((text ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return value || null;
};
function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attributes);
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? "") : null;
}

export function parseBrowserHtml(html: string): ParsedFile {
  const links: ImportedLink[] = [];
  const stack: string[] = [];
  let pendingFolder: string | null = null;
  let skipped = 0;
  let truncated = false;
  let last: ImportedLink | null = null;
  // Folders, links, list edges and the description that follows a link. Nothing else matters.
  const tokens = /<h3\b[^>]*>([\s\S]*?)<\/h3\s*>|<a\b([^>]*)>([\s\S]*?)<\/a\s*>|<(\/?)dl\b[^>]*>|<dd\b[^>]*>([^<]*)/gi;
  for (const match of html.matchAll(tokens)) {
    if (match[1] !== undefined) {
      pendingFolder = cleanText(match[1]) ?? "";
      last = null;
    } else if (match[2] !== undefined) {
      last = null;
      const parsed = parseLink(attribute(match[2], "href") ?? "");
      if (!parsed) { skipped++; continue; }
      if (links.length >= MAX_IMPORT) { truncated = true; continue; }
      last = {
        url: parsed.url, key: parsed.key, title: cleanText(match[3]), note: null, excerpt: null,
        tags: tagsFromFolders(stack, (attribute(match[2], "tags") ?? "").split(",")),
        savedAt: parseSavedAt(attribute(match[2], "add_date")),
      };
      links.push(last);
    } else if (match[4] !== undefined) {
      if (match[4] === "/") stack.pop();
      else { stack.push(pendingFolder ?? ""); pendingFolder = null; }
      last = null;
    } else if (match[5] !== undefined && last) {
      last.note = cleanText(match[5])?.slice(0, 4000) ?? null;
      last = null;
    }
  }
  return { format: "browser_html", links, skipped, truncated };
}

/** RFC 4180: quoted fields, doubled quotes and newlines inside quotes. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && !field) quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const COLUMNS = {
  url: ["url", "link", "href", "address"],
  title: ["title", "name"],
  note: ["note", "notes", "comment", "comments"],
  excerpt: ["excerpt", "description", "summary"],
  folder: ["folder", "collection", "category", "path"],
  tags: ["tags", "tag", "labels"],
  savedAt: ["created", "created_at", "createdat", "date", "time_added", "add_date", "saved", "saved_at", "added", "added_at"],
} as const;

export function parseCsv(text: string): ParsedFile | null {
  const rows = parseCsvRows(text);
  const header = rows[0]?.map((name) => name.trim().toLowerCase());
  if (!header) return null;
  const at = (names: readonly string[]) => header.findIndex((name) => names.includes(name));
  const column = { url: at(COLUMNS.url), title: at(COLUMNS.title), note: at(COLUMNS.note), excerpt: at(COLUMNS.excerpt), folder: at(COLUMNS.folder), tags: at(COLUMNS.tags), savedAt: at(COLUMNS.savedAt) };
  if (column.url < 0) return null;
  const links: ImportedLink[] = [];
  let skipped = 0, truncated = false;
  for (const row of rows.slice(1)) {
    if (row.every((cell) => !cell.trim())) continue;
    const parsed = parseLink(row[column.url] ?? "");
    if (!parsed) { skipped++; continue; }
    if (links.length >= MAX_IMPORT) { truncated = true; break; }
    const value = (index: number) => (index >= 0 ? row[index]?.trim() || null : null);
    links.push({
      url: parsed.url, key: parsed.key, title: value(column.title), note: value(column.note)?.slice(0, 4000) ?? null, excerpt: value(column.excerpt)?.slice(0, 600) ?? null,
      tags: tagsFromFolders((value(column.folder) ?? "").split("/"), (value(column.tags) ?? "").split(/[,|]/)),
      savedAt: parseSavedAt(value(column.savedAt)),
    });
  }
  return { format: "csv", links, skipped, truncated };
}

/** Every http or https link in free text, one record each, in order. */
export function parseLinkList(text: string): ParsedFile {
  const links: ImportedLink[] = [];
  let truncated = false;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/gi)) {
    const parsed = parseLink(match[0].replace(/[.,;:!?]+$/, ""));
    if (!parsed) continue;
    if (links.length >= MAX_IMPORT) { truncated = true; break; }
    links.push({ url: parsed.url, key: parsed.key, title: null, note: null, excerpt: null, tags: [], savedAt: null });
  }
  return { format: "link_list", links, skipped: 0, truncated };
}

export function parseImport(text: string): ParsedFile {
  const head = text.slice(0, 4096);
  if (/<!doctype\s+netscape-bookmark/i.test(head) || /<dt>\s*<a\s/i.test(text.slice(0, 200_000))) return parseBrowserHtml(text);
  return parseCsv(text) ?? parseLinkList(text);
}

/** The same page twice in one file is one link, keeping every tag and the earliest date. */
export function mergeDuplicates(links: readonly ImportedLink[]): ImportedLink[] {
  const byKey = new Map<string, ImportedLink>();
  for (const link of links) {
    const seen = byKey.get(link.key);
    if (!seen) { byKey.set(link.key, { ...link, tags: [...link.tags] }); continue; }
    seen.tags = cleanTags([...seen.tags, ...link.tags]);
    seen.title ??= link.title;
    seen.note ??= link.note;
    seen.excerpt ??= link.excerpt;
    if (link.savedAt && (!seen.savedAt || link.savedAt < seen.savedAt)) seen.savedAt = link.savedAt;
  }
  return [...byKey.values()];
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** A Netscape file every browser and bookmark service can read back. */
export function toBrowserHtml(records: Iterable<{ url: string; title: string; note: string | null; tags: string[]; savedAt: string }>): string {
  const lines = ["<!DOCTYPE NETSCAPE-Bookmark-file-1>", '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', "<TITLE>Bookmarks</TITLE>", "<H1>Bookmarks</H1>", "<DL><p>"];
  for (const record of records) {
    const date = Math.floor(Date.parse(record.savedAt) / 1000);
    const tags = record.tags.length ? ` TAGS="${escapeHtml(record.tags.join(","))}"` : "";
    lines.push(`    <DT><A HREF="${escapeHtml(record.url)}" ADD_DATE="${date}"${tags}>${escapeHtml(record.title)}</A>`);
    if (record.note) lines.push(`    <DD>${escapeHtml(record.note).replace(/\s+/g, " ")}`);
  }
  lines.push("</DL><p>", "");
  return lines.join("\n");
}
