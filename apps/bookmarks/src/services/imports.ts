/**
 * Two-step import. A file arrives in parts, because one action input is capped.
 * Preview parses it and stores the result under an expiring ID and digest
 * without changing a record. Apply applies exactly that result, once.
 */
import { AppError } from "@ri/app-kit/contract";
import { newId, sha256, transaction } from "@ri/app-kit/data";
import { mergeDuplicates, parseImport, parseLinkList, type ImportedLink, type ParsedFile } from "../domain/parse.js";
import type { Bookmarks } from "./core.js";

const PREVIEW_MS = 60 * 60_000;
const MAX_FILE_CHARS = 32 * 1024 * 1024;
export interface PreviewInput { uploadId?: string; text?: string; fileName?: string | null }

export function createImports(t: Bookmarks) {
  function sweep() {
    const before = new Date(t.now().getTime() - PREVIEW_MS).toISOString();
    t.run("DELETE FROM import_previews WHERE expires_at < ?", t.stamp());
    t.run("DELETE FROM import_parts WHERE created_at < ?", before);
  }
  function addPart(input: { uploadId: string; part: number; total: number; text: string }) {
    t.run(
      "INSERT INTO import_parts (upload_id, part, created_at, updated_at, total, text) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(upload_id, part) DO UPDATE SET text = excluded.text, total = excluded.total, updated_at = excluded.updated_at",
      input.uploadId, input.part, t.stamp(), t.stamp(), input.total, input.text,
    );
    return { received: input.part + 1, total: input.total };
  }
  function uploaded(uploadId: string): string {
    const rows = t.all("SELECT part, total, text FROM import_parts WHERE upload_id = ? ORDER BY part", uploadId);
    const total = Number(rows[0]?.total ?? 0);
    if (!rows.length || rows.length !== total) throw new AppError("invalid_input", "The file did not finish uploading. Choose it again");
    const text = rows.map((row) => String(row.text)).join("");
    if (text.length > MAX_FILE_CHARS) throw new AppError("invalid_input", "This file is larger than 32 MB");
    return text;
  }
  function preview(input: PreviewInput) {
    sweep();
    const source = input.uploadId ? uploaded(input.uploadId) : input.text;
    if (!source?.trim()) throw new AppError("invalid_input", "Choose a file or paste some links");
    const parsed: ParsedFile = input.uploadId ? parseImport(source) : parseLinkList(source);
    if (input.uploadId) t.run("DELETE FROM import_parts WHERE upload_id = ?", input.uploadId);
    const links = mergeDuplicates(parsed.links);
    if (!links.length) throw new AppError("invalid_input", parsed.skipped ? "This file has no web links to import" : "No links were found. Export bookmarks as HTML from your browser, or use a CSV with a url column");
    const items = JSON.stringify(links);
    const digest = sha256(items);
    const id = newId();
    const time = t.stamp();
    const expiresAt = new Date(t.now().getTime() + PREVIEW_MS).toISOString();
    t.run("INSERT INTO import_previews (id, created_at, updated_at, expires_at, digest, file_name, format, items, skipped, applied_at, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
      id, time, time, expiresAt, digest, input.fileName?.slice(0, 200) ?? null, parsed.format, items, parsed.skipped);
    const known = links.filter((link) => t.byKey(link.key)).length;
    const tags = new Map<string, number>();
    for (const link of links) for (const tag of link.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    return {
      previewId: id, digest, format: parsed.format, fileName: input.fileName?.slice(0, 200) ?? null, total: links.length, fresh: links.length - known, known, skipped: parsed.skipped, truncated: parsed.truncated,
      tags: [...tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([tag, count]) => ({ tag, count })),
      samples: links.slice(0, 6).map((link) => ({ url: link.url, title: link.title, tags: link.tags.slice(0, 6) })),
      expiresAt,
    };
  }
  function apply(input: { previewId: string; digest: string }) {
    const row = t.one("SELECT digest, items, expires_at, applied_at, result FROM import_previews WHERE id = ?", input.previewId);
    if (!row || String(row.expires_at) < t.stamp()) throw new AppError("not_found", "This preview expired. Choose the file again");
    if (row.digest !== input.digest) throw new AppError("conflict", "This preview changed. Choose the file again");
    if (row.applied_at) return { ...JSON.parse(String(row.result)) as { added: number; updated: number; unchanged: number; invalid: number }, status: "already_applied" as const };
    const links = JSON.parse(String(row.items)) as ImportedLink[];
    return transaction(t.db, () => {
      const counts = { added: 0, updated: 0, unchanged: 0, invalid: 0 };
      for (const link of links) {
        const outcome = t.saveOne(link, "import");
        if (outcome.status === "created") counts.added++;
        else if (outcome.status === "updated") counts.updated++;
        else if (outcome.status === "unchanged") counts.unchanged++;
        else counts.invalid++;
      }
      const time = t.stamp();
      // The parsed list has done its work. Keep only what a repeat click needs to answer.
      t.run("UPDATE import_previews SET items = '[]', applied_at = ?, result = ?, updated_at = ? WHERE id = ?", time, JSON.stringify(counts), time, input.previewId);
      return { ...counts, status: "applied" as const };
    });
  }
  return { addPart, preview, apply };
}
