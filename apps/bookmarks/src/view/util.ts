export function errorMessage(error: unknown, fallback = "This could not be completed. Try again."): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return raw || fallback;
}

/** A date people recognize, with the year only when it isn't this year. */
export function savedLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export const VIA_LABELS: Record<string, string> = {
  extension: "Saved from your browser", bookmark: "Browser bookmark", bookmarklet: "Saved from your browser", shortcut: "Saved from your phone",
  chat: "Saved by a chat", added: "Added here", import: "Imported", fixture: "Fictional example",
};

export const initialOf = (site: string) => [...site.trim()][0]?.toUpperCase() ?? "?";
export const parseTags = (text: string) => text.split(/[,\n]/).map((tag) => tag.trim()).filter(Boolean);
export function uuid(): string {
  return crypto.randomUUID();
}

/** Decode a selected file. Browser exports hold favicons inline, which can be most of the file and are never used. */
export function readSelectedFile(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes).replace(/\s+ICON(?:_URI)?="[^"]*"/gi, "");
}
export const PART_CHARS = 500_000;
export function splitParts(text: string, size = PART_CHARS): string[] {
  const parts: string[] = [];
  for (let index = 0; index < text.length; index += size) parts.push(text.slice(index, index + size));
  return parts.length ? parts : [""];
}

/**
 * Copy from inside a sandboxed frame. The async clipboard is denied to these
 * frames, so this uses a selection. False means the person copies it by hand,
 * and the text stays on screen for that.
 */
export function copyText(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

export const isHttps = (url: string) => url.toLowerCase().startsWith("https://");
