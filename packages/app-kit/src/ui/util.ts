/** Internal helpers shared by the UI kit modules. */
import { isLocalDate } from "../time.js";

export type ClassValue = string | false | null | undefined;
/** Join class names, skipping empty values. */
export function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}

/**
 * A version 4 UUID for invocation IDs. Uses `crypto.randomUUID` when the
 * context offers it and builds one from `getRandomValues` otherwise, since an
 * opaque view frame served over plain HTTP may lack `randomUUID`.
 */
export function newInvocationId(): string {
  const cryptoObject = globalThis.crypto;
  if (typeof cryptoObject?.randomUUID === "function") return cryptoObject.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoObject.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Cut text to at most `max` UTF-16 units without splitting a surrogate pair,
 * which `encodeURIComponent` would reject.
 */
export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

/** Stable JSON for comparing inputs and states. Object keys are sorted. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(item as Record<string, unknown>).sort()) sorted[key] = (item as Record<string, unknown>)[key];
      return sorted;
    }
    return item;
  }) ?? "undefined";
}

/** Readable text for a caught value. */
export function errorMessage(error: unknown, fallback = "Something went wrong. Try again."): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export function isLocalDateString(value: unknown): value is string {
  return typeof value === "string" && isLocalDate(value);
}

/** True when a keyboard event comes from a control that uses typing keys itself. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("[contenteditable=''], [contenteditable='true']")) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(type);
}

/** Elements that can take keyboard focus inside a container, in tab order. */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
  const selector = [
    "a[href]", "button:not([disabled])", "input:not([disabled]):not([type='hidden'])", "select:not([disabled])",
    "textarea:not([disabled])", "summary", "[tabindex]:not([tabindex='-1'])", "[contenteditable='true']",
  ].join(",");
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter((element) => {
    if (element.closest("[inert]") || element.hidden) return false;
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (style && (style.visibility === "hidden" || style.display === "none")) return false;
    return element.getClientRects().length > 0;
  });
}
