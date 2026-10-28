import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { McpFormError } from '@integrations/engine/mcp';
import type { ActionCallOrigin } from '@integrations/engine';
import { processState } from '@/lib/process-state';
import { getAttachmentsDir } from '@/lib/config/paths';
import { chatPlacement, getChatSessionWithExecution, getWorkspace, insertChatEvent } from '@/lib/db/queries';
import { sessionIdFromCaller } from '@/lib/integrations/approval';
import { acceptsFile, parseForm, type FormContent, type FormField, type ParsedForm, type PreviewTarget } from './form-schema';
import { MCP_FORM_EVENT, MCP_FORM_RESPONSE_EVENT } from './form-events';
import { serverRunsHere } from './files';
import type { McpServerEntry } from '@/lib/integrations/mcp-servers';

export { MCP_FORM_EVENT, MCP_FORM_RESPONSE_EVENT };

/**
 * Forms an MCP server asks a person to fill while a tool runs: MCP's form
 * elicitation and OpenAI's extended forms (docs/connected-mcp-apps.md,
 * "Forms"). The integration engine gives each form the run that caused it
 * (`ActionCallOrigin`), so it goes to exactly that chat, or that app view when
 * an app's own call asked. A form whose asker Ri cannot tell is refused, never
 * shown to someone else.
 *
 * Pending forms live in `processState`: a form holds a tool call open, so it
 * ends when the call does, and a restart cancels it.
 *
 * Ri doesn't validate an answer: the server does. A server that refuses one
 * asks again, with another round or request from the same call. When that
 * form has the same fields, it opens with what the person entered last time
 * and the server's new message as the reason (`again`), so they can fix it.
 */

/** What Ri tells every server it supports: MCP form elicitation and OpenAI's extended forms. */
export const MCP_FORM_CAPABILITIES = { elicitation: { form: {} }, extensions: { 'openai/elicitation': { form: {} } } } as const;

/**
 * A 2025-era form holds the server's call open, which Ri ends after 10
 * minutes without progress, so it is answered within 9. A 2026-07-28 round
 * holds nothing open, so it may wait up to the call's 30-minute total.
 */
export const FORM_TTL_MS = 9 * 60_000;
export const ROUND_FORM_TTL_MS = 25 * 60_000;
const MAX_FORMS = 32;
const MAX_PER_PLACE = 4;
const MAX_MESSAGE = 4000;
/** A server's preview resource, shown in the form. */
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
/** How long an answered form stays readable, so its card can say what happened. */
const KEEP_ANSWERED_MS = 30 * 60_000;

export type FormPlace = { kind: 'chat'; chatId: string } | { kind: 'view'; viewId: string; viewerId: string; chatId?: string };
export type FormStatus = 'open' | 'accepted' | 'declined' | 'cancelled' | 'expired';
export type FormAnswer = { action: 'accept'; content: FormContent } | { action: 'decline' } | { action: 'cancel' };

interface PendingForm {
  id: string; serverId: string; app: string; local: boolean; place: FormPlace;
  message: string; schema: Record<string, unknown>; form: ParsedForm;
  created: number; expires: number; status: FormStatus; settled?: number;
  /** The call and place this form came from, and its fields, to know when the same call asks again. */
  asked?: { key: string; fields: string };
  /** What the person entered when the same call asked these fields before. */
  again?: FormContent;
  resolve: (answer: FormAnswer) => void;
}

const forms = () => processState('mcp-forms', () => new Map<string, PendingForm>());
/** The last answer per call and place, kept as long as an answered form, for a server that asks again. */
const lastAnswers = () => processState('mcp-form-last-answers', () => new Map<string, { fields: string; content: FormContent; at: number }>());
const MAX_LAST_ANSWERS = 64;
const placeKey = (p: FormPlace) => p.kind === 'chat' ? `chat:${p.chatId}` : `view:${p.viewId}`;
const fieldsKey = (form: ParsedForm) => JSON.stringify(form.fields.map(f => [f.name, f.kind]));

/**
 * What every MCP connection Ri opens gets for forms: the capabilities, and a
 * handler that brings each form to whoever caused the call.
 */
export function mcpFormOptions(entry: Pick<McpServerEntry, 'id' | 'displayName' | 'url' | 'providerId'> & Partial<McpServerEntry>) {
  return {
    capabilities: MCP_FORM_CAPABILITIES as unknown as Record<string, unknown>,
    onElicit: (request: { method: 'elicitation/create' | 'openai/elicitation/create'; params: Record<string, unknown>; round?: boolean }, signal: AbortSignal, origin?: unknown) =>
      answerMcpForm({ serverId: entry.id, app: entry.displayName, local: isLocalMcpServer(entry), request, signal, origin }) as Promise<Record<string, unknown>>,
  };
}

/**
 * A server on this computer, for which a `file://` URI means something: the
 * same rule files use (`serverRunsHere`), a catalog command Ri starts itself
 * or a URL on the loopback interface.
 */
export function isLocalMcpServer(entry: Pick<McpServerEntry, 'url' | 'providerId'> & Partial<McpServerEntry>) {
  return serverRunsHere(entry);
}

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * The schema a request carries. OpenAI's legacy method sends it plainly. On
 * 2026-07-28 it rides in `_meta["openai/elicitation"].requestedSchema`, with an
 * empty core form as a placeholder that is never shown on its own (OpenAI's
 * spec). A plain MCP form uses its core schema.
 */
function requestedSchema(request: { method: string; params: Record<string, unknown>; round?: boolean }): { schema: unknown } | { missing: true } {
  if (request.method === 'openai/elicitation/create') return { schema: request.params.requestedSchema };
  const extended = record(record(record(request.params._meta)?.['openai/elicitation'])?.requestedSchema);
  if (extended) return { schema: extended };
  const core = record(request.params.requestedSchema);
  if (request.round && core && !Object.keys(record(core.properties) ?? {}).length) return { missing: true };
  return { schema: core };
}

/** Where a form goes: the app view whose call asked, else the chat whose call asked. */
function placeFor(origin: ActionCallOrigin | undefined): FormPlace | null {
  const caller = origin?.caller;
  const chatId = sessionIdFromCaller(caller);
  if (caller?.connectedApp) return { kind: 'view', viewId: caller.connectedApp.viewId, viewerId: caller.connectedApp.viewerId, ...(chatId ? { chatId } : {}) };
  if (chatId && getChatSessionWithExecution(chatId)) return { kind: 'chat', chatId };
  return null;
}

function prune(now = Date.now()) {
  for (const [id, form] of forms()) if (form.status !== 'open' && (form.settled ?? 0) + KEEP_ANSWERED_MS <= now) forms().delete(id);
  for (const [key, answer] of lastAnswers()) if (answer.at + KEEP_ANSWERED_MS <= now) lastAnswers().delete(key);
}

function recordOutcome(form: PendingForm, outcome: FormStatus) {
  if (form.place.kind !== 'chat') return;
  insertChatEvent({
    sessionId: form.place.chatId, role: 'system', source: 'system', content: MCP_FORM_RESPONSE_EVENT,
    raw: { subtype: MCP_FORM_RESPONSE_EVENT, formId: form.id, outcome, app: form.app },
    externalEventId: `mcp-form-answer:${form.id}`, createdAt: new Date().toISOString(),
  });
}

function settle(form: PendingForm, status: Exclude<FormStatus, 'open'>, answer: FormAnswer) {
  if (form.status !== 'open') return false;
  form.status = status;
  form.settled = Date.now();
  recordOutcome(form, status);
  form.resolve(answer);
  return true;
}

/**
 * A server's form, from the integration runtime's `onElicit`. Resolves with
 * the person's answer as MCP's `ElicitResult`: accept with content, decline,
 * or cancel when the form expires or its call ends. Throws `McpFormError`
 * when the form cannot be shown: unsupported, unplaceable or over the limit.
 */
export async function answerMcpForm(input: {
  serverId: string; app: string; local: boolean;
  request: { method: 'elicitation/create' | 'openai/elicitation/create'; params: Record<string, unknown>; round?: boolean };
  signal: AbortSignal; origin?: unknown;
}): Promise<FormAnswer> {
  const place = placeFor(input.origin as ActionCallOrigin | undefined);
  if (!place) throw new McpFormError('Ri could not tell which chat asked for this form, so it was not shown.', 'unrouted');
  const mode = input.request.params.mode;
  if (mode !== undefined && mode !== 'form') throw new McpFormError(`Ri shows forms, not ${typeof mode === 'string' ? mode : 'this kind of'} requests.`, 'unsupported');
  const message = typeof input.request.params.message === 'string' ? input.request.params.message.slice(0, MAX_MESSAGE) : '';
  const requested = requestedSchema(input.request);
  const parsed = 'missing' in requested ? { ok: false as const, reason: 'The form came without its fields.' } : parseForm(requested.schema);
  if (!parsed.ok) {
    if (place.kind === 'chat') notice(place.chatId, input.app, parsed.reason);
    throw new McpFormError(`Ri cannot show the form ${input.app} asked for. ${parsed.reason}`, 'unsupported');
  }
  prune();
  const open = [...forms().values()].filter(form => form.status === 'open');
  if (open.length >= MAX_FORMS || open.filter(form => placeKey(form.place) === placeKey(place)).length >= MAX_PER_PLACE) {
    throw new McpFormError('Too many forms are already waiting for an answer here.', 'unavailable');
  }
  if (input.signal.aborted) return { action: 'cancel' };
  const now = Date.now();
  // A server on another computer cannot read this one's files, so it gets only the items it offered.
  const form: ParsedForm = input.local ? parsed.form : { ...parsed.form, fields: parsed.form.fields.map(f => f.kind === 'resource' ? { ...f, userOptions: undefined } : f) };
  // The same call asking the same fields again: the server refused what the person entered.
  const attempt = (input.origin as ActionCallOrigin | undefined)?.attemptId;
  const asked = attempt ? { key: `${placeKey(place)}|${input.serverId}|${attempt}`, fields: fieldsKey(form) } : undefined;
  const previous = asked ? lastAnswers().get(asked.key) : undefined;
  return new Promise<FormAnswer>(resolve => {
    const pending: PendingForm = {
      id: randomUUID(), serverId: input.serverId, app: input.app, local: input.local, place, message,
      schema: parsed.form.schema, form, created: now, expires: now + (input.request.round ? ROUND_FORM_TTL_MS : FORM_TTL_MS), status: 'open',
      ...(asked ? { asked } : {}), ...(previous && previous.fields === asked?.fields ? { again: previous.content } : {}),
      resolve: answer => { clearTimeout(timer); input.signal.removeEventListener('abort', abort); resolve(answer); },
    };
    const timer = setTimeout(() => settle(pending, 'expired', { action: 'cancel' }), pending.expires - now);
    timer.unref?.();
    const abort = () => settle(pending, 'cancelled', { action: 'cancel' });
    input.signal.addEventListener('abort', abort, { once: true });
    forms().set(pending.id, pending);
    if (place.kind === 'chat') {
      insertChatEvent({ id: pending.id, sessionId: place.chatId, role: 'system', source: 'system', content: MCP_FORM_EVENT,
        raw: { subtype: MCP_FORM_EVENT, app: input.app }, externalEventId: `mcp-form:${pending.id}`, createdAt: new Date(now).toISOString() });
      void notifyForm(pending);
    }
  });
}

/** A form the person could not be shown, said in the chat that asked, so the failure is not silent. */
function notice(chatId: string, app: string, reason: string) {
  insertChatEvent({ sessionId: chatId, role: 'system', source: 'system', content: MCP_FORM_RESPONSE_EVENT,
    raw: { subtype: MCP_FORM_RESPONSE_EVENT, outcome: 'unsupported', app, reason }, createdAt: new Date().toISOString() });
}

/** A chat waiting on a form is a chat waiting on its person, so it notifies as one. */
async function notifyForm(form: PendingForm) {
  if (form.place.kind !== 'chat') return;
  try {
    const { notifyNeedsInput } = await import('@/lib/notifications/emit');
    await notifyNeedsInput({ sessionId: form.place.chatId, requestId: `mcp-form:${form.id}`, title: 'Answer needed', body: `${form.app} is asking for details.` });
  } catch { /* A missed notification leaves the card in the chat. */ }
}

/**
 * Only the chat's people, or the viewer whose app view asked. Form procedures
 * admit only the owner's own sign-ins (`connectedViewerProcedure`, the
 * `viewer` scope), each of which may read every chat in the home, and never
 * a team member, so a chat's form needs no further check.
 */
function reachable(form: PendingForm, viewerId: string) {
  return form.place.kind === 'chat' || form.place.viewerId === viewerId;
}
function find(formId: string, viewerId: string) {
  prune();
  const form = forms().get(formId);
  if (!form || !reachable(form, viewerId)) throw new Error('This form is no longer waiting for an answer.');
  return form;
}

/** The folders a local server's directory input can name: the chat's agent folder and its reference folders, when they are on this computer. */
async function chatFolders(chatId: string | undefined): Promise<{ label: string; path: string }[]> {
  if (!chatId) return [];
  const chat = getChatSessionWithExecution(chatId);
  const placement = chatPlacement(chatId);
  if (!chat?.workspaceId || (placement && !placement.isHome)) return [];
  const workspace = getWorkspace(chat.workspaceId);
  const folders: { label: string; path: string }[] = [];
  const own = (chat as { worktreePath?: string | null }).worktreePath ?? workspace?.cwd;
  if (own && fs.existsSync(own)) folders.push({ label: workspace?.name ?? path.basename(own), path: own });
  try {
    const { listResolvedReferenceFolders } = await import('@/lib/reference-folders/resolve');
    for (const reference of await listResolvedReferenceFolders(chat.workspaceId, { probeGit: false })) {
      if (reference.exists && reference.absolutePath) folders.push({ label: reference.alias, path: reference.absolutePath });
    }
  } catch { /* The agent's own folder is enough. */ }
  return folders;
}

/** A form as its card or overlay shows it. */
export async function getConnectedForm(formId: string, viewerId: string) {
  const form = find(formId, viewerId);
  const chatId = form.place.chatId;
  const folders = form.local && form.form.fields.some(f => f.kind === 'resource' && f.userOptions) ? await chatFolders(chatId) : [];
  return {
    id: form.id, app: form.app, serverId: form.serverId, message: form.message, schema: form.schema,
    status: form.status, expiresAt: form.expires, place: form.place.kind, chatId: chatId ?? null,
    viewId: form.place.kind === 'view' ? form.place.viewId : null,
    // Whether the person may add their own files or folders, for a server on this computer.
    local: form.local, folders: folders.map(folder => ({ label: folder.label, uri: pathToFileURL(folder.path).href })),
    // The same call asked these fields before: what the person entered then, and the message is the server's reason.
    again: form.again ?? null,
  };
}

/** The open forms an app view's own calls asked for, newest last. */
export function listViewForms(viewId: string, viewerId: string) {
  prune();
  return [...forms().values()].filter(form => form.status === 'open' && form.place.kind === 'view' && form.place.viewId === viewId && form.place.viewerId === viewerId)
    .sort((a, b) => a.created - b.created).map(form => form.id);
}

function field(form: PendingForm, name: string) {
  const found = form.form.fields.find(f => f.name === name);
  if (!found || found.kind !== 'resource') throw new Error('This field does not take files.');
  return found as Extract<FormField, { kind: 'resource' }>;
}

/**
 * A file or folder the person adds to a resource field, as the `file://` URI a
 * local server receives. A file is a chat attachment or a file in one of the
 * chat's folders. A folder is one of those folders or a folder inside one.
 * Each is checked here: it exists, is the kind asked for, matches the field's
 * `accept`, and stays inside its folder.
 */
export async function connectedFormFile(formId: string, viewerId: string, fieldName: string, pick: { attachment: string } | { folder: string; path?: string }) {
  const form = find(formId, viewerId);
  if (form.status !== 'open') throw new Error('This form is no longer waiting for an answer.');
  const target = field(form, fieldName);
  if (!form.local || !target.userOptions) throw new Error(`${form.app} only takes the items it listed.`);
  let resolved: string;
  if ('attachment' in pick) {
    if (!/^[\w.-]{1,200}$/.test(pick.attachment) || pick.attachment.startsWith('.')) throw new Error('That attachment name is not valid.');
    resolved = path.join(getAttachmentsDir(), pick.attachment);
  } else {
    const folders = await chatFolders(form.place.chatId);
    const base = folders.find(folder => pathToFileURL(folder.path).href === pick.folder);
    if (!base) throw new Error('That folder is not one of this chat\'s folders.');
    const relative = (pick.path ?? '').replace(/^[/\\]+/, '');
    resolved = path.resolve(/* turbopackIgnore: true */ base.path, relative);
    const root = fs.realpathSync(base.path);
    const real = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
    if (real !== root && !real.startsWith(root + path.sep)) throw new Error('That path leaves the folder.');
  }
  const stat = fs.statSync(resolved, { throwIfNoEntry: false });
  if (!stat) throw new Error('Nothing exists at that path.');
  if (target.userOptions.kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) throw new Error(target.userOptions.kind === 'directory' ? 'Choose a folder.' : 'Choose a file.');
  const name = path.basename(resolved);
  if (target.userOptions.kind === 'file' && !acceptsFile(target.userOptions.accept, name)) throw new Error(`${form.app} takes ${target.userOptions.accept.join(', ')} files.`);
  return { uri: pathToFileURL(resolved).href, name };
}

/** User-added `file://` URIs in an answer must still point where `connectedFormFile` allowed. */
async function checkUserFiles(form: PendingForm, content: FormContent) {
  for (const f of form.form.fields) {
    if (f.kind !== 'resource' || !Object.hasOwn(content, f.name)) continue;
    const values = Array.isArray(content[f.name]) ? content[f.name] as unknown[] : [content[f.name]];
    for (const uri of values) {
      // Anything but a URI is the server's to judge. Only an added file is Ri's to check.
      if (typeof uri !== 'string' || f.options.some(option => option.uri === uri)) continue;
      if (!f.userOptions || !form.local) throw new Error('Choose from the listed items.');
      if (!uri.startsWith('file://')) throw new Error('An added item must be a file on this computer.');
      const file = fileURLToPath(uri);
      const roots = [getAttachmentsDir(), ...(await chatFolders(form.place.chatId)).map(folder => folder.path)].map(root => fs.existsSync(root) ? fs.realpathSync(root) : root);
      const real = fs.existsSync(file) ? fs.realpathSync(file) : file;
      if (!roots.some(root => real === root || real.startsWith(root + path.sep))) throw new Error('An added item is outside this chat\'s files.');
    }
  }
}

/**
 * The person's answer, sent as they entered it. The server validates it.
 * Ri checks only that a file the person added is still where it was allowed.
 */
export async function answerConnectedForm(formId: string, viewerId: string, answer: { action: 'accept'; content: Record<string, unknown> } | { action: 'decline' | 'cancel' }) {
  const form = find(formId, viewerId);
  if (form.status !== 'open') throw new Error('This form is no longer waiting for an answer.');
  if (answer.action !== 'accept') {
    settle(form, answer.action === 'decline' ? 'declined' : 'cancelled', { action: answer.action });
    return { status: form.status };
  }
  const content = answer.content as FormContent;
  await checkUserFiles(form, content);
  if (settle(form, 'accepted', { action: 'accept', content }) && form.asked) {
    if (lastAnswers().size >= MAX_LAST_ANSWERS) lastAnswers().delete(lastAnswers().keys().next().value!);
    lastAnswers().set(form.asked.key, { fields: form.asked.fields, content, at: Date.now() });
  }
  return { status: form.status };
}

function previewIn(form: PendingForm, matchesTarget: (target: PreviewTarget) => boolean) {
  return form.form.fields.some(f => f.kind === 'resource' && f.options.some(option => option.preview && matchesTarget(option.preview)));
}

/**
 * A `resource_link` preview: the linked resource, read from the asking server
 * on its account. Only links the form itself offers, so a page cannot use a
 * form to read anything else.
 */
export async function connectedFormPreview(formId: string, viewerId: string, uri: string) {
  const form = find(formId, viewerId);
  if (!previewIn(form, target => target.type === 'resource_link' && target.uri === uri)) throw new Error('This form does not offer that preview.');
  const { getMcpViewConnection } = await import('@/lib/integrations/runtime');
  const transport = await getMcpViewConnection(form.serverId);
  if (!transport) throw new Error(`${form.app} is reconnecting. Try again in a moment.`);
  const result = await transport.readResource({ uri });
  const contents = result.contents.filter(item => item.uri === uri || result.contents.length === 1).slice(0, 4);
  if (Buffer.byteLength(JSON.stringify(contents)) > MAX_PREVIEW_BYTES) throw new Error('This preview is too large to show here.');
  return { contents: contents.map(item => ({ uri: item.uri, ...(item.mimeType ? { mimeType: item.mimeType } : {}), ...(item.text !== undefined ? { text: item.text } : {}), ...(item.blob !== undefined ? { blob: item.blob } : {}) })) };
}

/**
 * An `mcp_app_tool` preview: the asking server's app, opened with the
 * arguments its form named, through the ordinary approval gate. Only targets
 * the form offers.
 */
export async function prepareConnectedFormPreview(formId: string, viewerId: string, name: string, args: Record<string, unknown>) {
  const form = find(formId, viewerId);
  const same = (target: PreviewTarget) => target.type === 'mcp_app_tool' && target.name === name && JSON.stringify(target.arguments) === JSON.stringify(args);
  if (!previewIn(form, same)) throw new Error('This form does not offer that preview.');
  const { prepareConnectedLaunch } = await import('./service');
  return prepareConnectedLaunch(form.serverId, viewerId, name, { kind: 'preview', args, ...(form.place.chatId ? { chatId: form.place.chatId } : {}) });
}
