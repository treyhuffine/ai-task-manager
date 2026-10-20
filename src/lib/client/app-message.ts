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
/** What one view's messages may upload in all, so an app cannot fill the Home's attachments. */
export const MAX_UPLOAD_BYTES_PER_VIEW = 64 * 1024 * 1024;

/** A per-view allowance for uploads: `take` claims bytes, or says there is no room. */
export interface UploadBudget { take(bytes: number): boolean }

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
 *
 * `files: false` leaves files out, as for a message the person's input did
 * not lead to, and so does a `budget` with no room left. `omitted` counts them.
 */
export async function appMessageParts(content: readonly MessageBlock[], upload: (file: Blob, name: string) => Promise<Attachment>,
  options: { files?: boolean; budget?: UploadBudget } = {}): Promise<{ parts: AppDraftPart[]; omitted: number }> {
  const parts: AppDraftPart[] = [];
  let textBytes = 0, files = 0, omitted = 0;
  const addText = (part: Extract<AppDraftPart, { type: 'text' | 'snippet' }>) => {
    const room = MAX_MESSAGE_TEXT - textBytes;
    if (room <= 0) return;
    const text = part.text.length > room ? `${part.text.slice(0, room)} [cut]` : part.text;
    textBytes += text.length;
    parts.push({ ...part, text });
  };
  const addFile = async (data: string, mimeType: string, name: string) => {
    if (++files > MAX_MESSAGE_FILES) throw new Error(`An app message can attach ${MAX_MESSAGE_FILES} files at most.`);
    if (options.files === false) { omitted++; return; }
    const bytes = base64Bytes(data);
    if (options.budget && !options.budget.take(bytes.length)) { omitted++; return; }
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
  return { parts, omitted };
}

/**
 * Whether an app may send without the person pressing Send. OpenAI's spec
 * sends by default, so Ri sends, but only a request the person's own input
 * inside that view led to: Ri's relay frame had transient user activation
 * when it passed the request on (`ViewMessage.activated`). Script focusing
 * itself grants none, and neither does input elsewhere in Ri, so an app that
 * sends on its own, at load or in the background, gets a draft instead.
 * Sends are spaced at least 5 seconds apart, the browser's activation
 * window, so one click or key press sends once, and one view sends at most
 * 30 times. The gate belongs to the view, so a remount keeps its count
 * (`appMessageGate`). It also holds the view's upload allowance.
 */
export const SEND_SPACING_MS = 5_000;
export const MAX_SENDS_PER_VIEW = 30;
export type GateRefusal = 'no-interaction' | 'too-fast' | 'limit';
export class AppMessageGate implements UploadBudget {
  private lastSend = -Infinity;
  private sends = 0;
  private uploaded = 0;
  constructor(private readonly now: () => number = Date.now) {}
  take(bytes: number) {
    if (this.uploaded + bytes > MAX_UPLOAD_BYTES_PER_VIEW) return false;
    this.uploaded += bytes;
    return true;
  }
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

const gates = new Map<string, AppMessageGate>();
const MAX_GATES = 256;
/** The gate for one view, kept across remounts of it. */
export function appMessageGate(viewId: string): AppMessageGate {
  let gate = gates.get(viewId);
  if (!gate) {
    if (gates.size >= MAX_GATES) gates.delete(gates.keys().next().value!);
    gate = new AppMessageGate();
    gates.set(viewId, gate);
  }
  return gate;
}

/** The quiet note a view shows when its send became a draft. */
export function draftNotice(app: string, reason: GateRefusal | 'busy' | 'failed'): string {
  switch (reason) {
    case 'no-interaction': return `${app} wrote a message for you. It's in the draft, ready when you are.`;
    case 'too-fast': return `${app} sent messages too quickly, so this one is in the draft.`;
    case 'limit': return `${app} has sent its limit of messages here, so this one is in the draft.`;
    case 'busy': return `${app} asked for a new chat while this one is still working, so its message is in the draft here.`;
    default: return `${app}'s message couldn't be sent, so it's in the draft.`;
  }
}

/** The note for files a message left out: none without the person's input, or past the view's upload allowance. */
export function omittedNotice(app: string, count: number): string {
  return count === 1 ? `${app}'s message left out its file.` : `${app}'s message left out its ${count} files.`;
}

/** A chat as the router needs it: what kind it is and whose. */
export interface RoutedSession { id: string; type: 'orchestration' | 'content' | 'execution'; workspaceId: string | null }
export interface MessageRouting {
  session(chatId: string): Promise<RoutedSession | null>;
  /** The person's main chat, as it is now. */
  mainChat(): Promise<string>;
  /** Start a fresh main chat, the app's (`null`) or an agent's, and show it. Null when the home refused because the current one is still working. */
  newMainChat(scope: string | null): Promise<string | null>;
  /** Whether the scope's current main chat has a turn running or work in the background, which a new one would end. */
  mainChatBusy(scope: string | null): Promise<boolean>;
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
 *
 * Only a message the person's input in the view led to (`activated`) may
 * start a chat or bring one into view. Any other goes to the active chat,
 * quietly. A new main chat ends the current one, so while that chat is still
 * working the message stays in the active chat instead (`busy`), to be sent
 * by the person.
 */
export async function routeAppMessage(viewChatId: string | null | undefined, target: 'active' | 'new', routing: MessageRouting,
  { activated }: { activated: boolean }): Promise<{ chatId: string; busy?: true }> {
  if (!activated) return { chatId: viewChatId ?? await routing.mainChat() };
  const active = async () => {
    if (viewChatId) return viewChatId;
    routing.showMainChat();
    return routing.mainChat();
  };
  if (target === 'active') return { chatId: await active() };
  const session = viewChatId ? await routing.session(viewChatId) : null;
  if (session?.type === 'execution') return { chatId: await routing.newExecutionChat(session.id) };
  const scope = session?.type === 'orchestration' ? session.workspaceId : null;
  if (await routing.mainChatBusy(scope)) return { chatId: await active(), busy: true };
  const chatId = await routing.newMainChat(scope);
  if (chatId === null) return { chatId: await active(), busy: true };
  if (scope === null) routing.showMainChat();
  return { chatId };
}
