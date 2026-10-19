import type { Attachment } from '@/db/types';
import type { AppDraftPart } from './app-chat-intent';

/**
 * OpenAI's `ui/message` extension in Ri (docs/connected-mcp-apps.md,
 * "Messages"): what an app's content becomes in a composer, which chat it
 * goes to, and whether it may be sent without the person pressing Send.
 */

/** A content block from `ui/message`: text, image, resource link or embedded resource. */
export type MessageBlock = { type: string; [key: string]: unknown };

/** One message's text may run this long. Longer text is cut, and the cut is marked. */
export const MAX_MESSAGE_TEXT = 64 * 1024;
/** Files one message may carry, and the size of each. Attachment uploads allow 50 MiB. */
export const MAX_MESSAGE_FILES = 8;
export const MAX_MESSAGE_FILE_BYTES = 20 * 1024 * 1024;

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown) => typeof value === 'string' && value ? value : undefined;
const titleOf = (block: MessageBlock) => {
  const title = record(block._meta)['openai/title'];
  return typeof title === 'string' && title.trim() ? title.trim().slice(0, 200) : undefined;
};

function base64Bytes(data: string): Uint8Array {
  const binary = atob(data);
  if (binary.length > MAX_MESSAGE_FILE_BYTES) throw new Error('A file from the app is too large to attach.');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A display name for an attached file, with an extension from its type when it has none. */
function fileName(base: string, mimeType: string) {
  const name = base.split(/[\\/]/).filter(Boolean).pop()?.slice(0, 120) || 'file';
  if (/\.[a-z0-9]{1,8}$/i.test(name)) return name;
  const ext = mimeType.split('/')[1]?.split(/[+;]/)[0]?.replace(/[^a-z0-9]/gi, '');
  return ext ? `${name}.${ext}` : name;
}

/**
 * Turn a message's content blocks into composer parts. Untitled text is
 * ordinary text. Titled text (`_meta["openai/title"]`) is a labeled item the
 * person removes as one. An image, or an embedded resource's blob, uploads
 * as an attachment. A resource link is its title and URI, and an embedded
 * text resource a titled item. Other block types are refused, as
 * `ui/message` supports only these four.
 */
export async function appMessageParts(content: readonly MessageBlock[], upload: (file: Blob, name: string) => Promise<Attachment>): Promise<AppDraftPart[]> {
  const parts: AppDraftPart[] = [];
  let textBytes = 0, files = 0;
  const addText = (part: Extract<AppDraftPart, { type: 'text' | 'snippet' }>) => {
    const room = MAX_MESSAGE_TEXT - textBytes;
    if (room <= 0) return;
    const text = part.text.length > room ? `${part.text.slice(0, room)} [cut]` : part.text;
    textBytes += text.length;
    parts.push({ ...part, text });
  };
  const addFile = async (data: string, mimeType: string, name: string) => {
    if (++files > MAX_MESSAGE_FILES) throw new Error(`An app message can attach ${MAX_MESSAGE_FILES} files at most.`);
    const bytes = base64Bytes(data);
    const blob = new Blob([bytes as BlobPart], { type: mimeType });
    parts.push({ type: 'file', attachment: await upload(blob, fileName(name, mimeType)) });
  };
  for (const block of content) {
    const title = titleOf(block);
    if (block.type === 'text') {
      const text = str(block.text);
      if (!text) continue;
      addText(title ? { type: 'snippet', title, text } : { type: 'text', text });
    } else if (block.type === 'image') {
      const data = str(block.data), mimeType = str(block.mimeType);
      if (!data || !mimeType?.startsWith('image/')) throw new Error('The app sent an image Ri cannot read.');
      await addFile(data, mimeType, title ?? 'image');
    } else if (block.type === 'resource_link') {
      const uri = str(block.uri);
      if (!uri) continue;
      const label = str(block.title) ?? str(block.name);
      addText({ type: 'text', text: label && label !== uri ? `${label} (${uri})` : uri });
    } else if (block.type === 'resource') {
      const resource = record(block.resource), uri = str(resource.uri) ?? 'resource';
      const label = title ?? str(resource.title) ?? str(resource.name) ?? uri;
      if (typeof resource.text === 'string') addText({ type: 'snippet', title: label, text: resource.text });
      else if (typeof resource.blob === 'string') await addFile(resource.blob, str(resource.mimeType) ?? 'application/octet-stream', label);
    } else {
      throw new Error(`An app message cannot include ${block.type} content.`);
    }
  }
  return parts;
}

/**
 * Whether an app may send without the person pressing Send. OpenAI's spec
 * sends by default, so Ri sends, but only a request the person's own input
 * inside that view led to: Ri's relay frame had transient user activation
 * when it passed the request on (`ViewMessage.activated`). Script focusing
 * itself grants none, and neither does input elsewhere in Ri, so an app that
 * sends on its own, at load or in the background, gets a draft instead.
 * Sends are also spaced at least 3 seconds apart, and one view sends at most
 * 30 times.
 */
export const SEND_SPACING_MS = 3_000;
export const MAX_SENDS_PER_VIEW = 30;
export type GateRefusal = 'no-interaction' | 'too-fast' | 'limit';
export class AppMessageGate {
  private lastSend = -Infinity;
  private sends = 0;
  constructor(private readonly now: () => number = Date.now) {}
  /** Decide one send. `activated`: the person's input inside the view led to this request. */
  decide(activated: boolean): { send: true } | { send: false; reason: GateRefusal } {
    const now = this.now();
    if (!activated) return { send: false, reason: 'no-interaction' };
    if (now - this.lastSend < SEND_SPACING_MS) return { send: false, reason: 'too-fast' };
    if (this.sends >= MAX_SENDS_PER_VIEW) return { send: false, reason: 'limit' };
    this.lastSend = now;
    this.sends++;
    return { send: true };
  }
}

/** The quiet note a view shows when its send became a draft. */
export function draftNotice(app: string, reason: GateRefusal | 'failed'): string {
  switch (reason) {
    case 'no-interaction': return `${app} wrote a message for you. It's in the draft, ready when you are.`;
    case 'too-fast': return `${app} sent messages too quickly, so this one is in the draft.`;
    case 'limit': return `${app} has sent its limit of messages here, so this one is in the draft.`;
    default: return `${app}'s message couldn't be sent, so it's in the draft.`;
  }
}

/** A chat as the router needs it: what kind it is and whose. */
export interface RoutedSession { id: string; type: 'orchestration' | 'content' | 'execution'; workspaceId: string | null }
export interface MessageRouting {
  session(chatId: string): Promise<RoutedSession | null>;
  /** The person's main chat, as it is now. */
  mainChat(): Promise<string>;
  /** Start a fresh main chat, the app's (`null`) or an agent's, and show it. */
  newMainChat(scope: string | null): Promise<string>;
  /** Start a fresh chat in an execution, and show it. */
  newExecutionChat(sessionId: string): Promise<string>;
  /** Bring the main chat panel into view, beside a global screen. */
  showMainChat(): void;
}

/**
 * Which chat an app's message goes to. `active` is the chat the view is in.
 * A view with no chat (a global screen, a settings or preview window) uses
 * the main chat, shown beside it. `new` starts a fresh conversation on the
 * same surface: a new main chat for the main chat or a view with no chat,
 * a new chat for the same agent from an agent's main chat, a new chat in the
 * same execution from one of its chats (Ri's New chat there), and a new main
 * chat from a task or note chat.
 */
export async function routeAppMessage(viewChatId: string | null | undefined, target: 'active' | 'new', routing: MessageRouting): Promise<string> {
  if (target === 'active') {
    if (viewChatId) return viewChatId;
    routing.showMainChat();
    return routing.mainChat();
  }
  const session = viewChatId ? await routing.session(viewChatId) : null;
  if (session?.type === 'execution') return routing.newExecutionChat(session.id);
  const scope = session?.type === 'orchestration' ? session.workspaceId : null;
  const chatId = await routing.newMainChat(scope);
  if (scope === null) routing.showMainChat();
  return chatId;
}
