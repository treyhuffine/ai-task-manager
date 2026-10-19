import type { ChatEventRecord, EmailDraft, EntityVersionRecord, WorkResultRecord } from '@/db/types';
import type { PendingInput } from '@/lib/api/sessions';
import type { ApprovalRequestView } from '@/lib/integrations/approval-describe';
import type { ConnectionRequestView } from '@/lib/integrations/connection-catalog';
import { encodeSource, sourceMarker } from '@/lib/chat-sources/reference';
import type { SourceDescriptor } from '@/lib/chat-sources/types';

export const CHAT_ID = '019a0000-0000-7000-8000-000000000001';
export const DRAFT_ID = '019a0000-0000-7000-8000-000000000002';
export const RECORD_ID = '019a0000-0000-7000-8000-000000000003';
export const NOW = '2026-10-19T14:00:00.000Z';

export const HTML_DOCUMENT = `<!doctype html><html><head><style>
body{font:16px system-ui;padding:28px;background:light-dark(#f5f6f2,#20241e);color:light-dark(#293026,#e6ebdf)}h1{font-size:26px}p{line-height:1.6}button{font:inherit;padding:10px 16px;border:0;border-radius:8px;background:#516641;color:white;cursor:pointer}output{display:block;margin-top:16px;font-size:20px;font-weight:600}
</style></head><body><p>FRIDAY REVIEW</p><h1>A little more focus</h1><p>Three decisions. One owner for each next step. A review that leaves room to do the work.</p><button id="decision">Record an example decision</button><output id="count">0 decisions recorded</output><script>let count=0;document.getElementById('decision').onclick=()=>{count++;document.getElementById('count').textContent=count+' decisions recorded'};</script></body></html>`;

export function event(source: string, input: Partial<ChatEventRecord> = {}): ChatEventRecord {
  return { id: `${source}-example`, createdAt: NOW, updatedAt: NOW, sessionId: CHAT_ID, senderSessionId: null, authorMemberId: null, role: 'assistant', source, content: null, toolName: null, toolInput: null, toolIsError: null, toolExitCode: null, raw: null, externalEventId: null, externalMessageId: null, externalTurnId: null, externalToolCallId: null, externalParentToolCallId: null, sourcePartIndex: 0, partRevision: null, attachments: [], ...input };
}

export function emailDraft(state: string): EmailDraft {
  return { version: 1, revision: 0, status: state === 'sent' ? 'sent' : state === 'uncertain' ? 'uncertain' : 'draft', connectionId: 'gallery-gmail', to: 'alex@example.com', cc: '', bcc: '', subject: 'A quick project update', body: 'Hi Alex,\n\nThe dashboard is ready for review. Could we walk through it on Friday?\n\nThanks,\nSam', sentAt: state === 'sent' ? NOW : null, fromLabel: state === 'draft' ? null : 'sam@example.com', messageId: state === 'sent' ? 'gallery-message' : null, error: state === 'uncertain' ? 'Delivery could not be confirmed. Check Sent mail before creating another email' : null };
}

export function pendingInput(id: string, state: string): PendingInput[] {
  if (id === 'permissions') return [{ kind: 'permission', requestId: 'gallery-permission', sessionId: CHAT_ID, toolUseId: 'gallery-tool', toolName: 'Bash', input: { command: 'pnpm test --filter=calendar' }, title: 'Run the calendar tests', description: 'Checks the calendar changes before handing them back to you.', createdAt: NOW }];
  if (id !== 'questions') return [];
  const first = { header: 'Meeting format', question: 'How would you like to meet?', options: [{ label: 'Video call', description: 'A quick call from wherever you are.' }, { label: 'In person', description: 'Meet at the office.' }], multiSelect: state === 'multiple' };
  return [{ kind: 'question', requestId: 'gallery-question', sessionId: CHAT_ID, toolUseId: 'gallery-tool', originalInput: {}, questions: state === 'steps' ? [first, { header: 'Timing', question: 'Which day works best?', options: [{ label: 'Thursday', description: 'Morning or afternoon.' }, { label: 'Friday', description: 'A shorter end-of-week review.' }] }] : [first], createdAt: NOW }];
}

export function approvals(state: string): ChatEventRecord[] {
  const view: ApprovalRequestView = { approvalId: 'gallery-approval', actionId: 'google_calendar.create_event', toolName: 'google_calendar__create_event', actionLabel: 'Create event', toolkitName: 'Google Calendar', providerId: 'google', connectionId: 'gallery-google', account: 'sam@example.com', risk: 'medium', outward: true, summary: 'Project review · Fri, Oct 23, 10:00 AM', details: [{ label: 'Attendees', value: 'alex@example.com' }, { label: 'Duration', value: '30 minutes' }] };
  return [event('approval_request', { toolInput: view }), ...(state === 'batch' ? [event('approval_request', { id: 'approval-second', toolInput: { ...view, approvalId: 'gallery-approval-second', summary: 'Team planning · Mon, Oct 26, 9:00 AM' } })] : [])];
}

export const CONNECTION_VIEW: ConnectionRequestView = {
  kind: 'allow_agent', providerId: 'google', providerName: 'Google', toolkitIds: ['gmail'], label: 'Gmail', method: 'oauth2', credentialFields: [], reason: 'I need access to this account to help with your review.', requestedBy: 'agent', onBehalf: false, connectionId: 'gallery-gmail', scopes: null, authConfigId: null, account: 'sam@example.com', requestedAccount: null, agent: { workspaceId: RECORD_ID, name: 'Planning' }, accounts: [{ accountId: 'sam@example.com', connectionId: 'gallery-gmail', authConfigId: null, label: 'sam@example.com' }], preselected: ['sam@example.com'],
};

export function connectionResponse(outcome: string) {
  return event('connection_response', { id: 'connection-answer', toolIsError: outcome === 'declined', toolInput: { requestEventId: 'connection_request-example', outcome, providerId: 'google', label: 'Gmail', account: 'sam@example.com', toolkitIds: ['gmail'] }, content: outcome === 'declined' ? 'Not now' : 'Access granted' });
}

export const HANDOFF: WorkResultRecord = {
  id: RECORD_ID, createdAt: NOW, updatedAt: NOW, userId: 'local', actorSource: 'ai', actorUserId: 'local', actorSessionId: CHAT_ID, sourceChatSessionId: CHAT_ID, sourceExecutionId: null, sourceEventId: null, requestHash: 'gallery', title: 'A clearer Friday review', body: 'The project plan is ready.\n\n- Shortened the agenda to three decisions.\n- Included the open questions from the team.\n- Added a suggested owner for each next step.\n\nPlease review the plan and let me know what you would change.', attention: null, attachments: [], links: [], codeRevision: null, supersedesId: null,
};

export const VERSIONS: EntityVersionRecord[] = [
  { id: 'version-agent', createdAt: NOW, updatedAt: NOW, entityType: 'note', entityId: RECORD_ID, source: 'ai', summary: 'Clarified the review agenda', actorSessionId: CHAT_ID, actorMemberId: null, revertedFromVersionId: null, snapshot: { title: 'Friday review', body: '## Friday review\n\n1. Review the dashboard\n2. Decide what ships next\n3. Assign the follow-ups' } },
  { id: 'version-human', createdAt: '2026-10-19T13:00:00.000Z', updatedAt: '2026-10-19T13:00:00.000Z', entityType: 'note', entityId: RECORD_ID, source: 'human', summary: null, actorSessionId: null, actorMemberId: null, revertedFromVersionId: null, snapshot: { title: 'Friday review', body: '## Friday review\n\nLook at the dashboard and talk about next steps.' } },
];

/** Self-contained image, so opening this example never loads an account or attachment. */
export const IMAGE_URL = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="400" viewBox="0 0 720 400"><rect width="720" height="400" fill="#e8eee9"/><path d="M0 320 210 105 410 310 550 180 720 340V400H0Z" fill="#57715f"/><path d="m210 105 70 73-45-8-32 24-24-24-46 15Z" fill="#fff"/><circle cx="565" cy="90" r="35" fill="#d6b770"/><text x="32" y="365" fill="#fff" font-family="system-ui" font-size="24">A little room to think</text></svg>')}`;

/** Two fictional PDF pages, as the Home's renderer would draw them. */
export const PDF_PAGES = [
  ['Friday review', 'Decisions to make', 'What ships next', 'Who owns the follow-ups'],
  ['Follow-ups', 'Alex drafts the release note', 'Sam books the demo', 'Everyone reviews the dashboard'],
].map(([title, ...lines]) => `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="1656" viewBox="0 0 612 792"><rect width="612" height="792" fill="#fff"/><text x="64" y="110" font-family="system-ui" font-size="34" font-weight="600" fill="#111">${title}</text>${lines.map((line, i) => `<rect x="64" y="${170 + i * 64}" width="10" height="10" rx="5" fill="#57715f"/><text x="88" y="${180 + i * 64}" font-family="system-ui" font-size="20" fill="#333">${line}</text>`).join('')}</svg>`);

/** Fictional connected accounts, as the source adapter describes them. */
function source(toolkitId: string, providerId: string, service: string, account: string, several: boolean, over: Partial<SourceDescriptor> = {}): SourceDescriptor {
  const sourceRef = encodeSource({ v: 1, kind: 'integration', toolkitId, account: { accountId: `${toolkitId}:${account}`, authConfigId: null } });
  return { sourceRef, label: `${service} · ${account}`, chipLabel: several ? `${service} · ${account}` : service, service, accountLabel: account, mark: { kind: 'provider', providerId, toolkitId }, groupId: toolkitId, keywords: [], status: 'ready', chat: true, view: 'none', ...over };
}
export function mentionExample(state: string): { message: string; sources: SourceDescriptor[] } {
  if (state === 'several') {
    const sources = [source('gmail', 'google', 'Gmail', 'Work', true), source('gmail', 'google', 'Gmail', 'Personal', true)];
    return { sources, message: `Find the conference receipt in ${sourceMarker(sources[0].sourceRef)} and forward it from ${sourceMarker(sources[1].sourceRef)} to Alex.` };
  }
  if (state === 'attention') {
    const sources = [source('linear', 'linear', 'Linear', 'sam@example.com', false, { status: 'needs_access' }), source('magicpath', 'magicpath', 'MagicPath', 'sam@example.com', false)];
    return { sources, message: `File the onboarding bug in ${sourceMarker(sources[0].sourceRef)} and sketch the fix in ${sourceMarker(sources[1].sourceRef)}.` };
  }
  const sources = [source('todoist', 'todoist', 'Todoist', 'sam@example.com', false, { view: 'available', openPath: '/apps/~connected/gallery-todoist' })];
  return { sources, message: `${sourceMarker(sources[0].sourceRef)} What’s on my list today?` };
}
