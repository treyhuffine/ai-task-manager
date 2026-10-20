import type { Attachment } from "@/db/types";

/**
 * What apps put into a chat's composer, kept only in this browser while the
 * target composer loads.
 *
 * Local apps suggest plain text (`requestAppChatDraft`). Connected MCP apps
 * write OpenAI's extended `ui/message` (`requestAppChatMessage`): ordinary
 * text, titled items the person can remove as a unit, and files. Either way
 * it is a draft, and the person sends it (docs/connected-mcp-apps.md,
 * "Messages").
 */
export type AppDraftPart =
  | { type: "text"; text: string }
  | { type: "snippet"; title: string; text: string }
  | { type: "file"; attachment: Attachment };
export interface AppChatMessage {
  parts: AppDraftPart[];
}
/** What happened to a message: put in the draft, or waiting for its composer. */
export type AppChatDelivery = "drafted" | "queued";
export interface AppChatComposerHandlers {
  /** Appends parts to the draft: text, titled items and file chips. */
  appendParts?(parts: AppDraftPart[]): void;
}

/**
 * App text with any source marker (`[[source:…]]`) broken, so the person's
 * send never binds one of their accounts because an app wrote it: only the
 * person chooses sources. Brackets before `source:` become `(`, so two parts
 * side by side can't make one either.
 */
export const withoutSourceMarkers = (text: string) => text.replace(/\[+(?=source:)/g, "(");

type Request = { at: number } & ({ text: string } | { message: AppChatMessage });
type Composer = { append: (text: string) => void } & AppChatComposerHandlers;
const pending = new Map<string, Request[]>();
const composers = new Map<string, Composer>();
const QUEUE_MS = 60_000;

export function appChatIntent(path: string): { prompt: string } | null {
  const url = new URL(path, "https://app.invalid");
  if (url.origin !== "https://app.invalid" || url.pathname !== "/__host/chat")
    return null;
  const prompt = url.searchParams.get("prompt") ?? "";
  if (prompt.length > 2000) throw new Error("The app question is too long.");
  return { prompt };
}

/** The text of parts, for a composer that takes only text. A titled item is its text. */
export function appPartsText(parts: readonly AppDraftPart[]): string {
  return parts
    .flatMap((part) => (part.type === "file" ? [] : [part.text]))
    .join(" ")
    .trim();
}

/**
 * Parts as one message: titled items become their text and files their
 * `[[file:<name>]]` markers, in order, as the composer serializes chips.
 */
export function serializeAppParts(parts: readonly AppDraftPart[]): { text: string; attachments: Attachment[] } {
  const attachments: Attachment[] = [];
  const pieces = parts.map((part) => {
    if (part.type !== "file") return part.text;
    if (!attachments.some((a) => a.fileName === part.attachment.fileName)) attachments.push(part.attachment);
    return `[[file:${part.attachment.fileName}]]`;
  });
  return { text: pieces.join(" ").trim(), attachments };
}

export function requestAppChatDraft(chatId: string, draft: string) {
  if (draft.length > 2000) throw new Error("The app question is too long.");
  const text = withoutSourceMarkers(draft);
  const composer = composers.get(chatId);
  if (composer) {
    composer.append(text);
    return;
  }
  enqueue(chatId, { text, at: Date.now() });
}

/**
 * Put an app's message in a chat's draft. Queued for a minute when the
 * composer has not loaded yet, such as a new chat opening.
 */
export function requestAppChatMessage(chatId: string, message: AppChatMessage): AppChatDelivery {
  const composer = composers.get(chatId);
  if (!composer) {
    enqueue(chatId, { message, at: Date.now() });
    return "queued";
  }
  return deliver(composer, message);
}

function deliver(composer: Composer, message: AppChatMessage): AppChatDelivery {
  if (composer.appendParts) composer.appendParts(message.parts);
  else {
    const text = appPartsText(message.parts);
    if (text) composer.append(text);
  }
  return "drafted";
}

function enqueue(chatId: string, request: Request) {
  const requests = pending.get(chatId) ?? [];
  pending.set(chatId, [...requests.slice(-9), request]);
}

export function registerAppChatComposer(
  chatId: string,
  append: (text: string) => void,
  handlers: AppChatComposerHandlers = {},
) {
  const composer: Composer = { append, ...handlers };
  composers.set(chatId, composer);
  const requests = pending.get(chatId) ?? [];
  pending.delete(chatId);
  for (const request of requests) {
    if (Date.now() - request.at >= QUEUE_MS) continue;
    if ("text" in request) append(request.text);
    else deliver(composer, request.message);
  }
  return () => {
    if (composers.get(chatId) === composer) composers.delete(chatId);
  };
}
