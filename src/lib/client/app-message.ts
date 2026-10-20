import type { Attachment } from '@/db/types';
import { withoutSourceMarkers, type AppDraftPart } from './app-chat-intent';

/**
 * OpenAI's `ui/message` extension in Ri (docs/connected-mcp-apps.md,
 * "Messages"): what an app's content becomes in a composer, and which chat's
 * composer it goes to. It always becomes a draft the person sends: agents
 * act with the person's full access, so the person reads every word an app
 * wants sent before an agent acts on it.
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
 * A `budget` with no room left leaves further files out, and `omitted`
 * counts them.
 */
export async function appMessageParts(content: readonly MessageBlock[], upload: (file: Blob, name: string) => Promise<Attachment>,
  options: { budget?: UploadBudget } = {}): Promise<{ parts: AppDraftPart[]; omitted: number }> {
  const parts: AppDraftPart[] = [];
  let textBytes = 0, files = 0, omitted = 0;
  const addText = (part: Extract<AppDraftPart, { type: 'text' | 'snippet' }>) => {
    const room = MAX_MESSAGE_TEXT - textBytes;
    if (room <= 0) return;
    const safe = withoutSourceMarkers(part.text);
    const text = safe.length > room ? `${safe.slice(0, room)} [cut]` : safe;
    textBytes += text.length;
    parts.push({ ...part, text });
  };
  const addFile = async (data: string, mimeType: string, name: string) => {
    if (++files > MAX_MESSAGE_FILES) throw new Error(`An app message can attach ${MAX_MESSAGE_FILES} files at most.`);
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
      addText(title ? { type: 'snippet', title: withoutSourceMarkers(title), text } : { type: 'text', text });
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
      if (typeof resource.text === 'string') addText({ type: 'snippet', title: withoutSourceMarkers(label), text: resource.text });
      else if (typeof resource.blob === 'string') await addFile(resource.blob, str(resource.mimeType) ?? 'application/octet-stream', label);
    } else {
      throw new Error(`An app message cannot include ${block.type} content.`);
    }
  }
  return { parts, omitted };
}

/**
 * A view's upload allowance, kept across remounts of it (`appUploadBudget`).
 * Every app message is a draft, which needs no click, so this is what keeps a
 * screen from filling the Home's disk with draft attachments.
 */
export class ViewUploadBudget implements UploadBudget {
  private uploaded = 0;
  take(bytes: number) {
    if (this.uploaded + bytes > MAX_UPLOAD_BYTES_PER_VIEW) return false;
    this.uploaded += bytes;
    return true;
  }
}

const budgets = new Map<string, ViewUploadBudget>();
const MAX_BUDGETS = 256;
/** The upload allowance for one view, kept across remounts of it. */
export function appUploadBudget(viewId: string): ViewUploadBudget {
  let budget = budgets.get(viewId);
  if (!budget) {
    if (budgets.size >= MAX_BUDGETS) budgets.delete(budgets.keys().next().value!);
    budget = new ViewUploadBudget();
    budgets.set(viewId, budget);
  }
  return budget;
}

/**
 * The quiet note a view shows once its message is in a draft: where it is,
 * since nothing else moves on screen. `kept` is a new chat the app asked for
 * that wasn't started, as the person has written in the current one. A view
 * with no chat of its own (`mainChat`, a screen opened from Apps) names the
 * main chat, which may not be on screen beside it.
 */
export function draftNotice(app: string, reason: 'drafted' | 'kept', options: { mainChat?: boolean } = {}): string {
  if (options.mainChat) return reason === 'kept'
    ? `${app} asked for a new chat. Its message is in your main chat's draft, since that chat has your conversation in it.`
    : `${app} wrote a message for you. It's in your main chat's draft, ready when you are.`;
  return reason === 'kept'
    ? `${app} asked for a new chat. Its message is in the draft here, since this chat has your conversation in it.`
    : `${app} wrote a message for you. It's in the draft, ready when you are.`;
}

/** The note for files a message left out, past the view's upload allowance. */
export function omittedNotice(app: string, count: number): string {
  return count === 1 ? `${app}'s message left out its file.` : `${app}'s message left out its ${count} files.`;
}

/** A chat as the router needs it: what kind it is and whose. */
export interface RoutedSession { id: string; type: 'orchestration' | 'content' | 'execution'; workspaceId: string | null }
export interface MessageRouting {
  session(chatId: string): Promise<RoutedSession | null>;
  /** The person's main chat, as it is now. */
  mainChat(): Promise<string>;
  /**
   * A new main chat for an app, the person's (`null`) or an agent's: the
   * current one when nobody has written in it yet. Null when the home kept
   * the current one because the person has written in it (`forApp`).
   */
  newMainChat(scope: string | null): Promise<string | null>;
  /** A new chat in an execution for an app, shown: its newest when nobody has written in it yet (`forApp`). */
  newExecutionChat(sessionId: string): Promise<string>;
}

/**
 * Whose composer an app's draft goes to. `active` is the chat the view is in.
 * A view with no chat (a global screen, a settings or preview window) uses
 * the main chat. Nothing is brought into view without a click: the view's
 * notice says where the draft is. `new` is a fresh conversation on the same
 * surface with the draft in it, and sends nothing: a new main chat for the
 * main chat or a view with no chat, a new chat for the same agent from an
 * agent's main chat, a new chat in the same execution from one of its chats,
 * and a new main chat from a task or note chat. A new main chat would retire
 * the current one, so once the person has written in it the draft goes to
 * the active chat instead (`kept`).
 */
export async function routeAppMessage(viewChatId: string | null | undefined, target: 'active' | 'new', routing: MessageRouting): Promise<{ chatId: string; kept?: true }> {
  const active = async () => viewChatId || routing.mainChat();
  if (target === 'active') return { chatId: await active() };
  const session = viewChatId ? await routing.session(viewChatId) : null;
  if (session?.type === 'execution') return { chatId: await routing.newExecutionChat(session.id) };
  const scope = session?.type === 'orchestration' ? session.workspaceId : null;
  const chatId = await routing.newMainChat(scope);
  if (chatId === null) return { chatId: await active(), kept: true };
  return { chatId };
}
