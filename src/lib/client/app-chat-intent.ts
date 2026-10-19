import type { Attachment } from "@/db/types";

/**
 * What apps put into a chat's composer, kept only in this browser while the
 * target composer loads.
 *
 * Local apps suggest plain text (`requestAppChatDraft`). Connected MCP apps
 * send OpenAI's extended `ui/message` (`requestAppChatMessage`): ordinary
 * text, titled items the person can remove as a unit, and files, either
 * left as a draft or sent. A send carries the app as its provenance and
 * grants no permission. Whether an app may send at all is decided before it
 * gets here (`app-message.ts`, the interaction gate).
 */
export type AppDraftPart =
  | { type: "text"; text: string }
  | { type: "snippet"; title: string; text: string }
  | { type: "file"; attachment: Attachment };
/** The app a message came from, for the transcript and the harness. */
export interface AppProvenance {
  viewId: string;
  app: string;
}
export interface AppChatMessage {
  parts: AppDraftPart[];
  send: boolean;
  fromApp?: AppProvenance;
}
/** What happened to a message: sent, put in the draft, or waiting for its composer. */
export type AppChatDelivery = "sent" | "drafted" | "queued";
export interface AppChatComposerHandlers {
  /** Appends parts to the draft: text, titled items and file chips. */
  appendParts?(parts: AppDraftPart[]): void;
  /** Sends parts as a message from the app, without touching the draft. */
  send?(parts: AppDraftPart[], fromApp?: AppProvenance): Promise<void>;
}

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

export function requestAppChatDraft(chatId: string, text: string) {
  if (text.length > 2000) throw new Error("The app question is too long.");
  const composer = composers.get(chatId);
  if (composer) {
    composer.append(text);
    return;
  }
  enqueue(chatId, { text, at: Date.now() });
}

/**
 * Deliver an app's message to a chat's composer: sent when `send` is set and
 * the composer can send, otherwise appended to the draft. A send that fails
 * lands in the draft instead, so nothing the app wrote is lost. Queued for a
 * minute when the composer has not loaded yet, such as a new chat opening.
 */
export async function requestAppChatMessage(chatId: string, message: AppChatMessage): Promise<AppChatDelivery> {
  const composer = composers.get(chatId);
  if (!composer) {
    enqueue(chatId, { message, at: Date.now() });
    return "queued";
  }
  return deliver(composer, message);
}

async function deliver(composer: Composer, message: AppChatMessage): Promise<AppChatDelivery> {
  if (message.send && composer.send) {
    try {
      await composer.send(message.parts, message.fromApp);
      return "sent";
    } catch {
      // Refused or unreachable: keep what the app wrote where the person can send it.
    }
  }
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
    else void deliver(composer, request.message);
  }
  return () => {
    if (composers.get(chatId) === composer) composers.delete(chatId);
  };
}
