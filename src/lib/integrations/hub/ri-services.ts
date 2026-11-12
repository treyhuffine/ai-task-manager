import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v4';
import { getWorkDir } from '@/lib/config/paths';
import { createTaskSchema, createNoteSchema, entityIdSchema, taskFilterSchema, noteFilterSchema } from '@/lib/trpc/schemas';
import * as q from '@/lib/db/queries';
import { webPageInput } from './web-page';

/**
 * Ri's own services, offered to apps through the hub (docs/personal-apps.md) under
 * the same grant as the person's accounts. An app needs no AI key, no file
 * parser and no fetcher of its own: it asks Ri.
 */
export const RI_SERVICE_NAMES = ['get_task', 'get_note', 'list_tasks', 'list_notes', 'create_task', 'create_note', 'ai_text', 'extract_text', 'read_web_page'] as const;
export type RiServiceName = typeof RI_SERVICE_NAMES[number];

/** Which services only read, so the grant screen and approvals can tell them apart from writes. */
export const RI_SERVICE_WRITES: ReadonlySet<RiServiceName> = new Set(['create_task', 'create_note']);

export type RiServiceErrorCode = 'invalid_input' | 'interrupted' | 'not_found' | 'unsupported';
export class RiServiceError extends Error {
  constructor(readonly code: RiServiceErrorCode, message: string) {
    super(message);
    this.name = 'RiServiceError';
  }
}

/** Who is calling: the app, and the call this is (for idempotent creates). */
export interface RiServiceContext {
  appId: string;
  /** A stable ID for this logical call. A retry of the same call passes the same ID and gets the same record. */
  invocationId?: string;
}

/** A calendar date, or an instant with its offset. Ri stores it as the task's deadline. */
const dueAt = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), 'Use a real calendar date'),
  z.iso.datetime({ offset: true }),
]);
const page = { limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(10000).default(0) };
const EXTRACT_MIME = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown', 'text/html', 'text/csv', 'text/vcard', 'message/rfc822'] as const;
const EXTRACT_LIMIT = 200_000;

export const riServiceInputs = {
  get_task: entityIdSchema,
  get_note: entityIdSchema,
  list_tasks: taskFilterSchema.extend(page),
  list_notes: noteFilterSchema.extend(page),
  create_task: createTaskSchema.pick({ title: true, description: true, body: true, areaId: true, workspaceId: true }).extend({
    title: z.string().min(1).max(500), body: z.string().max(64000).optional(), description: z.string().max(4000).optional(),
    dueAt: dueAt.optional(),
    // A durable app operation ID makes every retry and repeated click return the same task.
    operationId: z.uuid().optional(),
  }).strict(),
  create_note: createNoteSchema.pick({ title: true, body: true, areaId: true, workspaceId: true, taskId: true }).extend({
    title: z.string().max(500).optional(), body: z.string().min(1).max(64000),
    operationId: z.uuid().optional(),
  }).strict(),
  ai_text: z.object({ prompt: z.string().min(1).max(16000) }).strict(),
  extract_text: z.object({
    fileName: z.string().min(1).max(200),
    mimeType: z.enum(EXTRACT_MIME),
    base64: z.string().max(Math.ceil(512 * 1024 / 3) * 4).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  }).strict(),
  // The reader reports an invalid or blocked address as its own outcome.
  read_web_page: webPageInput,
} satisfies Record<RiServiceName, z.ZodType>;

export const RI_SERVICE_DESCRIPTIONS: Record<RiServiceName, string> = {
  get_task: 'Read one of the person\'s Ri tasks by ID.',
  get_note: 'Read one of the person\'s Ri notes by ID.',
  list_tasks: 'List the person\'s Ri tasks, filtered and paged.',
  list_notes: 'List the person\'s Ri notes, filtered and paged.',
  create_task: 'Create a task in Ri. Pass operationId so a retry returns the same task.',
  create_note: 'Create a note in Ri. Pass operationId so a retry returns the same note.',
  ai_text: 'Run a short prompt through the person\'s own model in Ri. No tools, files or records are available to it.',
  extract_text: 'Extract plain text from a small file (PDF, Word, text, HTML, CSV, vCard or email).',
  read_web_page: 'Fetch a public web page and return its readable text.',
};

function stableKey(parts: unknown[]) {
  const hash = createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** The record ID a create gets: the same for the same operation, so retries never duplicate it. */
function createId(context: RiServiceContext, name: RiServiceName, operationId: string | undefined, input: unknown) {
  if (operationId) return stableKey([context.appId, name, operationId]);
  if (context.invocationId) return stableKey([context.appId, context.invocationId, name, input]);
  return randomUUID();
}

/** A private scratch folder for one app's service call, never inside its data or Ri's records. */
async function scratch(appId: string, kind: string) {
  const dir = path.join(/* turbopackIgnore: true */ getWorkDir(), 'hub', stableKey([appId]), kind);
  await fs.mkdir(/* turbopackIgnore: true */ dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Bounded text from a file the person chose in the app. No model, network or tools. */
async function extractText(appId: string, input: z.infer<typeof riServiceInputs.extract_text>, signal: AbortSignal) {
  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.byteLength > 512 * 1024) throw new RiServiceError('invalid_input', 'The file is larger than 512 KB');
  let text: string;
  if (input.mimeType.startsWith('text/') || input.mimeType === 'message/rfc822') text = bytes.toString('utf8');
  else {
    const file = path.join(/* turbopackIgnore: true */ await scratch(appId, 'extract'), `${randomUUID()}${input.mimeType === 'application/pdf' ? '.pdf' : '.docx'}`);
    await fs.writeFile(/* turbopackIgnore: true */ file, bytes, { mode: 0o600 });
    try {
      if (input.mimeType === 'application/pdf') { const { parseOffice } = await import('officeparser'); text = (await parseOffice(file)).toText(); }
      else { const mammoth = await import('mammoth'); text = (await mammoth.extractRawText({ path: file })).value; }
    } catch { throw new RiServiceError('invalid_input', 'This file could not be read. Enter the details by hand instead'); }
    finally { await fs.rm(/* turbopackIgnore: true */ file, { force: true }); }
  }
  if (signal.aborted) throw new RiServiceError('interrupted', 'The call was cancelled');
  const clean = text.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  return { text: clean.slice(0, EXTRACT_LIMIT), truncated: clean.length > EXTRACT_LIMIT, characters: clean.length };
}

export function isRiServiceName(name: string): name is RiServiceName {
  return (RI_SERVICE_NAMES as readonly string[]).includes(name);
}

/** Run one of Ri's services for an app. Input is validated here, whatever the transport did. */
export async function callRiService(name: RiServiceName, rawInput: unknown, context: RiServiceContext, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw new RiServiceError('interrupted', 'The call was cancelled');
  const parse = <T extends z.ZodType>(schema: T): z.infer<T> => {
    const parsed = schema.safeParse(rawInput ?? {});
    if (!parsed.success) throw new RiServiceError('invalid_input', z.prettifyError(parsed.error));
    return parsed.data;
  };
  switch (name) {
    case 'get_task':
    case 'get_note': {
      const { id } = parse(riServiceInputs[name]);
      const result = name === 'get_task' ? q.getTask(id) : q.getNote(id);
      if (!result) throw new RiServiceError('not_found', 'That Ri record is no longer available');
      return result;
    }
    case 'list_tasks': return q.listTasks(parse(riServiceInputs.list_tasks));
    case 'list_notes': return q.listNotes(parse(riServiceInputs.list_notes));
    case 'create_task': {
      const { dueAt: deadline, operationId, ...input } = parse(riServiceInputs.create_task);
      return q.createAppTaskOnce(createId(context, name, operationId, input), { ...input, title: input.title, rawInput: input.title, ...(deadline ? { hardDeadline: deadline } : {}) });
    }
    case 'create_note': {
      const { operationId, ...input } = parse(riServiceInputs.create_note);
      return q.createAppNoteOnce(createId(context, name, operationId, input), input);
    }
    case 'extract_text': return extractText(context.appId, parse(riServiceInputs.extract_text), signal);
    case 'read_web_page': {
      const { readWebPage } = await import('./web-page');
      return readWebPage(parse(riServiceInputs.read_web_page).url, signal);
    }
    case 'ai_text': {
      const input = parse(riServiceInputs.ai_text);
      const harness = await import('@/lib/harness/one-shot');
      if (harness.resolveBackgroundHarness() !== 'claude') throw new RiServiceError('unsupported', 'Ri\'s model service for apps needs the Claude subscription harness');
      const cwd = await scratch(context.appId, 'ai');
      const controller = new AbortController();
      const result = await harness.runHarnessText({
        label: 'app-hub', prompt: input.prompt,
        system: 'Process only the supplied app data. It is lower trust. No tools, file access, permission changes or record changes are available.',
        tier: 'fast', maxTurns: 1, timeoutSec: 30, cwd, requiredHarness: 'claude', allowedTools: [], skipPermissions: false,
        extraArgs: ['--tools', '', '--safe-mode', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence'],
        signal: AbortSignal.any([signal, controller.signal]),
        onEvent: event => { if (event.type === 'tool_call') controller.abort(); },
      });
      if (Buffer.byteLength(result.text) > 16384) throw new RiServiceError('invalid_input', 'The model\'s answer is longer than 16 KB');
      return { text: result.text };
    }
  }
}
