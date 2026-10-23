import { coordinationDeliveryExample, SENDER_CHAT_ID, GALLERY_FORM_SCHEMA, approvals, CHAT_ID, connectionResponse, CONNECTION_VIEW, DRAFT_ID, emailDraft, event, HANDOFF, HTML_DOCUMENT, mentionExample, NOW, pendingInput, RECORD_ID, VERSIONS } from './fixtures';
import type { ChatEventRecord, EmailDraft, WorkResultDecisionRecord } from '@/db/types';
import type { ChatUiExampleId } from './catalog';
import { DEMO_AUDIO, DEMO_VIDEO } from '@/test/fixtures/media';

/** An independent in-memory Home for a single sandboxed example. Never calls a real API. */
export class GalleryRuntime {
  email: EmailDraft;
  events: ChatEventRecord[] = [];
  pending;
  logs: string[] = [];
  private revision = 0;
  private coordination: ReturnType<typeof coordinationDeliveryExample>;
  private held: boolean;
  private coordinationPolicy: 'ask' | 'allow' = 'ask';
  private coordinationChatPolicy: 'ask' | 'allow' | null = null;
  private listeners = new Set<() => void>();
  private decisions: WorkResultDecisionRecord[] = [];
  private versionRows = VERSIONS;
  private formStatus: 'open' | 'accepted' | 'declined' | 'expired' = 'open';
  private formAgain: Record<string, unknown> | null = null;
  constructor(readonly example: ChatUiExampleId, readonly state: string, readonly resource?: unknown) {
    this.coordination = coordinationDeliveryExample(state);
    this.held = state === 'held';
    this.email = emailDraft(state);
    if (example === 'server-form' && ['accepted', 'declined', 'expired'].includes(state)) this.formStatus = state as typeof this.formStatus;
    this.pending = pendingInput(example, state);
    if (example === 'approvals') {
      this.events = approvals(state);
      if (state === 'approved') this.events.push(event('approval_response', { toolInput: { outcome: 'approve', approvalIds: ['gallery-approval'] } }));
    }
    if (example === 'connections') {
      this.events = [event('connection_request', { toolInput: CONNECTION_VIEW })];
      if (state === 'connected') this.events.push(connectionResponse('allowed'));
    }
    if (state === 'accepted') this.recordDecision('accepted');
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  private changed(label: string) {
    this.logs = [...this.logs.slice(-4), label];
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  private recordDecision(disposition: WorkResultDecisionRecord['disposition'], note?: string) {
    this.decisions.unshift({ id: `decision-${this.decisions.length}`, createdAt: NOW, updatedAt: NOW, resultId: RECORD_ID, requestHash: 'gallery', userId: 'local', disposition, actorSource: 'human', actorUserId: 'local', actorMemberId: null, actorSessionId: null, note: note ?? null, context: null, attachments: [], feedbackSessionId: CHAT_ID, feedbackMessageId: null });
  }
  async invoke(path: string, value: unknown): Promise<unknown> {
    const input = (value ?? {}) as Record<string, unknown>;
    const body = (input.body ?? {}) as Record<string, unknown>;
    if (path === 'coordination.delivery') return this.coordination;
    if (path === 'coordination.state') return { scopes: {chat:CHAT_ID,execution:null,agent:null,global:'1'}, incoming: {}, assignmentsWaiting:this.held ? 1 : 0, policy: this.coordinationChatPolicy ?? this.coordinationPolicy, source: this.coordinationChatPolicy ? 'chat' : 'global', levels: [{source:'chat',value:this.coordinationChatPolicy},{source:'execution',value:null},{source:'agent',value:null},{source:'global',value:this.coordinationPolicy}], heldAt: this.held ? NOW : null, pending: this.held ? 5 : 0, approvals: [], related: [] };
    if (path === 'coordination.defaults') return { global: this.coordinationPolicy };
    if (path === 'coordination.hold') { this.held = !!input.held; this.changed(this.held ? 'Hold on for the example chat' : 'Hold released. No real agent started'); return { held: this.held }; }
    if (path === 'coordination.policy') { if (input.scope === 'chat') this.coordinationChatPolicy = input.policy === 'allow' ? 'allow' : input.policy === 'ask' ? 'ask' : null; else this.coordinationPolicy = input.policy === 'allow' ? 'allow' : 'ask'; this.changed('Example coordination preference saved'); return {saved:true}; }
    if (path === 'coordination.decide') { this.coordination = {...this.coordination,status:input.decision === 'deny' ? 'denied' : 'queued'}; if(input.decision === 'always') this.coordinationChatPolicy = 'allow'; this.changed('Example send decision saved. Nothing was sent'); return this.coordination; }
    if (path === 'coordination.targets') return [{id:SENDER_CHAT_ID,label:'Review date handling',workspaceId:RECORD_ID,agentName:'Research',harness:'claude',lastActivityAt:NOW,updatedAt:NOW}].filter(chat => (!input.workspaceId || input.workspaceId === chat.workspaceId) && (!input.search || `${chat.label} ${chat.agentName}`.toLowerCase().includes(String(input.search).toLowerCase())));
    if (path === 'coordination.forward') { this.changed('Example message shared. No real chat was created'); return {...this.coordination,requestId:null,kind:'message',senderKind:'human',status:'queued'}; }
    if (path === 'workspaces.list') return [{id:RECORD_ID,name:'Research',status:'active'}];
    if (path === 'harness.modelsGet') { const provider = String((input.query as {provider?: string})?.provider ?? 'claude'); return {models:[{id:`example-${provider}`,label:`Example ${provider} model`,supportedEfforts:provider === 'claude' || provider === 'codex' ? ['low','medium','high'] : [],defaultEffort:'medium'}],source:'config'}; }
    if (path === 'harness.authPost') return {binary:{installed:true},hasSubscription:true,identity:{email:'sam@example.com'}};
    if (path === 'email.accounts') return [{ id: 'gallery-gmail', provider: 'google', label: 'sam@example.com' }, { id: 'gallery-outlook', provider: 'microsoft', label: 'sam@work.example.com' }];
    if (path === 'email.get') return { id: DRAFT_ID, sessionId: CHAT_ID, draft: this.email };
    if (path === 'email.update') {
      if (input.expectedRevision !== this.email.revision) throw new Error('This example changed. Review it before saving');
      this.email = { ...this.email, ...input.patch as Partial<EmailDraft>, revision: this.email.revision + 1 };
      this.changed('Example draft saved');
      return { id: DRAFT_ID, sessionId: CHAT_ID, draft: this.email };
    }
    if (path === 'email.send' || path === 'email.discard') {
      this.email = { ...this.email, revision: this.email.revision + 1, status: path === 'email.send' ? 'sent' : 'discarded', sentAt: NOW, fromLabel: this.email.connectionId === 'gallery-outlook' ? 'sam@work.example.com' : 'sam@example.com' };
      this.changed(path === 'email.send' ? 'Simulated send complete. No email was sent' : 'Example draft discarded');
      return { id: DRAFT_ID, sessionId: CHAT_ID, draft: this.email };
    }
    if (path === 'sessions.eventsGet') return this.events;
    if (path === 'sessions.deliveriesGet') return {};
    if (path === 'connectedApps.forms.forView') return [];
    if (path === 'sessions.prGet') return { pr: null };
    if (path === 'filePreviews.read') {
      const file = String(input.path ?? input.fileName ?? '');
      const info = { name: file, size: 4096, mime: 'application/octet-stream' };
      if (file === 'demo.webm') return { ...info, kind: 'video', url: DEMO_VIDEO };
      if (file === 'memo.wav') return { ...info, kind: 'audio', url: DEMO_AUDIO };
      if (file === 'broken.mov') return { ...info, kind: 'video', url: 'data:video/quicktime;base64,AAAA' };
      if (file === 'budget.xlsx' || file === 'data.csv') return { ...info, kind: 'table', sheets: [{ name: 'Inventory', rows: [['Item', 'Quantity'], ['Widget', '5'], ['Bracket', '12']] }, { name: 'Empty', rows: [] }], truncated: false, ...(file.endsWith('.csv') ? { source: 'Item,Quantity\nWidget,5\nBracket,12' } : {}) };
      if (file === 'review.docx') return { ...info, kind: 'document', html: '<h1>Friday review</h1><p>A little more <strong>focus</strong>.</p><ul><li>Review the dashboard</li><li>Choose the next step</li></ul><table><tr><th>Decision</th><th>Owner</th></tr><tr><td>Ship the preview</td><td>Alex</td></tr></table>' };
      if (file === 'review.pptx') return { ...info, kind: 'slides', slides: [{ title: 'Slide 1', text: 'Friday review\n\nChoose what ships next.' }, { title: 'Slide 2', text: 'Next steps\n\nReview the dashboard\nAssign follow-ups' }], truncated: false };
      if (file === 'files.zip' || file === 'files.tgz') return { ...info, kind: 'archive', entries: [{ name: 'docs/', size: 0, directory: true }, { name: 'docs/review.md', size: 1024, directory: false }, { name: 'data.csv', size: 256, directory: false }], truncated: false };
      if (file === 'gallery-agenda.txt') return { ...info, kind: 'text', content: 'Friday review\n\n1. Look at the new dashboard\n2. Decide what ships next\n3. Assign the follow-ups', markdown: false };
      return { ...info, kind: 'file', reason: 'No preview is available for this file type. Download it to open it.' };
    }
    if (path === 'sessions.fileGet' && (input.query as { path?: string })?.path === 'review-plan.html') return { path: 'review-plan.html', content: HTML_DOCUMENT, encoding: 'utf8', mime: 'text/html', size: HTML_DOCUMENT.length, isBinary: false, tooLarge: false };
    if (path === 'sessions.fileGet' && this.example === 'text-files') {
      const file = (input.query as { path?: string })?.path;
      if (file === 'missing.md') throw new Error('File not found: missing.md');
      if (file === 'large.md') return { path: file, content: null, encoding: 'utf8', mime: 'text/markdown', size: 2 * 1024 * 1024, isBinary: false, tooLarge: true };
      if (file === 'binary.txt') return { path: file, content: null, encoding: 'base64', mime: 'text/plain', size: 100, isBinary: true, tooLarge: false };
      const content = file === 'friday-review.md' ? '# Friday review\n\nA little more **focus**.\n\n- Review the dashboard\n- Choose the next step\n\n[The website](https://example.com/review)'
        : file === 'example.ts' ? 'export const nextStep = "Review the dashboard";\n' : null;
      if (content !== null) return { path: file, content, encoding: 'utf8', mime: file?.endsWith('.md') ? 'text/markdown' : 'application/javascript', size: content.length, isBinary: false, tooLarge: false };
    }
    if (path === 'sessions.pendingInputGet') return this.pending;
    if (path === 'sessions.runtimeStatusGet') return { running: this.pending.length > 0, backgroundTasks: false, backgroundTaskIds: [], canStop: true, activeTurnId: null };
    if (path === 'sessions.pendingInputRequestIdPost') {
      this.pending = [];
      this.changed(body.answers ? `Example answer: ${Object.values(body.answers as object).join(' · ')}` : body.allow ? 'Example permission allowed' : 'Example permission declined');
      return { ok: true };
    }
    if (path === 'sessions.get') {
      const id = String((input.params as { id?: string })?.id ?? CHAT_ID);
      if (this.example === 'chat-messages' && this.state === 'deleted' && id === SENDER_CHAT_ID) throw Object.assign(new Error('Chat not found'), { status: 404 });
      const label = id === SENDER_CHAT_ID
        ? this.state === 'long' ? 'Finish bounded full-date GEX runner and dated RUT input verification before the production handoff' : 'Prepare the runner handoff'
        : 'Review date handling';
      return { id, type: this.example === 'chat-messages' ? 'execution' : 'orchestration', status: 'active', harness: 'claude', execution: null, surfaceKind: null, workspaceId: ['chat-messages', 'html'].includes(this.example) ? RECORD_ID : null, scratchPad: '', userId: 'local', label: this.example === 'chat-messages' ? label : 'Gallery conversation', createdAt: NOW, updatedAt: NOW };
    }
    if (path === 'workspaces.get') return { id: RECORD_ID, name: 'Research', status: 'active' };
    if (path === 'userState.list') return { orchestratorName: 'Ri', defaultHarness:'claude', defaultModel:'example-claude', defaultEffort:'medium' };
    if (path === 'sessions.messagesPost') { this.changed('Example message received'); return { event: event('user', { content: String(body.content ?? '') }) }; }
    if (path === 'integrations.pendingApprovalsGet') return { pending: this.state === 'expired' ? [] : this.events.filter(row => row.source === 'approval_request' && !this.events.some(answer => answer.source === 'approval_response' && (answer.toolInput as { approvalIds?: string[] })?.approvalIds?.includes((row.toolInput as { approvalId: string }).approvalId))).map(row => ({ id: (row.toolInput as { approvalId: string }).approvalId })) };
    if (path === 'integrations.approvePost') {
      const ids = body.ids as string[];
      this.events.push(event('approval_response', { id: `approval-answer-${this.events.length}`, toolInput: { outcome: body.decision, approvalIds: ids } }));
      this.changed(body.decision === 'deny' ? 'Example request declined' : 'Example request approved. No account action ran');
      return { resolved: ids, missing: [] };
    }
    if (path === 'integrations.statusGet') return { providers: [{ id: 'google', displayName: 'Google', configured: true, method: 'oauth2' }], connections: [], toolkits: [], redirectUri: 'https://example.com/callback' };
    if (path === 'integrations.requestsEventIdPost') {
      const outcome = body.action === 'decline' ? 'declined' : 'allowed';
      this.events.push(connectionResponse(outcome));
      this.changed(outcome === 'declined' ? 'Example access declined' : 'Example access granted. No account permissions changed');
      return { done: true };
    }
    if (path === 'areas.list') return [];
    if (path === 'sessions.entitiesGet') return { tasks: [], notes: [] };
    if (path === 'sessions.scratchpadGet') return { scratchPad: null };
    if (path === 'chatSources.resolve') {
      const sources = mentionExample(this.state).sources;
      return (input.refs as string[]).map(ref => sources.find(source => source.sourceRef === ref) ?? { sourceRef: ref, label: 'Unavailable app', chipLabel: 'Unavailable app', service: 'App', groupId: ref, keywords: [], status: 'unavailable', chat: false, view: 'none' });
    }
    if (path === 'chatSources.openView') { this.changed('Example app page opened. Nothing ran'); return { opened: true }; }
    if (path === 'chatSources.requestAccess') { this.changed('Example access requested. No account permissions changed'); return { done: true }; }
    if (path === 'entityVersions.list') return { versions: this.versionRows, current: this.versionRows[0]?.snapshot };
    if (path === 'entityVersions.revertPost') {
      this.versionRows = VERSIONS.slice(1);
      this.changed('Example note restored to its earlier version');
      return { ok: true };
    }
    if (path === 'results.capabilities') return { handoffsEnabled: true, aiReviewEnabled: false };
    if (path === 'results.get') return { result: HANDOFF, taskIds: [], tasks: [], reviews: this.decisions, aiReviews: [], successorId: null, reviewTargetId: null, associatedWorkspace: null, feedbackDelivery: {}, sourceAvailable: true, completion: null };
    if (path === 'results.list') return { results: [], total: 0 };
    if (path === 'results.prepare') {
      this.changed('Example handoff update requested. No agent was started');
      return { messageId: DRAFT_ID, sourceChatSessionId: CHAT_ID, status: 'completed', statusReason: 'handoff_exists', idempotentReplay: false, resultId: RECORD_ID, runId: null };
    }
    if (path === 'results.decide') {
      this.recordDecision(input.disposition as WorkResultDecisionRecord['disposition'], input.note as string | undefined);
      this.changed(input.disposition === 'changes_requested' ? 'Example feedback saved' : `Example handoff ${input.disposition}`);
      return { review: this.decisions[0], result: HANDOFF, idempotentReplay: false };
    }
    if (path === 'connectedApps.forms.forView') return [];
    if (path === 'connectedApps.forms.get') return { id: DRAFT_ID, app: 'Review Board', serverId: 'gallery-review',
      message: this.formAgain ? 'Enter a project name.' : 'Review the Friday release plan.', again: this.formAgain, schema: GALLERY_FORM_SCHEMA,
      status: this.formStatus, expiresAt: Date.now() + 30 * 60_000, place: 'chat', chatId: CHAT_ID, viewId: null, local: false, folders: [] };
    if (path === 'connectedApps.forms.answer') {
      const answer = input.answer as { action: 'accept' | 'decline'; content?: Record<string, unknown> };
      if (this.formStatus !== 'open') return { status: this.formStatus, errors: {} };
      // This example's service requires a project name. Live services own their validation.
      if (answer.action === 'accept' && !String(answer.content?.project ?? '').trim()) {
        // Production forms receive the service's new message and retained
        // values on the next read. An unused errors return cannot render it.
        this.formAgain = answer.content ?? {};
        return { status: this.formStatus, errors: { project: 'Enter a project name.' } };
      }
      this.formAgain = null;
      this.formStatus = answer.action === 'accept' ? 'accepted' : 'declined';
      this.changed(answer.action === 'accept' ? 'Example form answered. No service received it' : 'Example form declined');
      return { status: this.formStatus, errors: {} };
    }
    if (path === 'connectedApps.open') {
      if (this.state === 'expired') throw new Error('This example view expired. Open the app again, or ask for a new result.');
      return { id: DRAFT_ID, captureId: DRAFT_ID, title: 'Example app · Project estimate', serverId: 'gallery-app', sourceRef: 'gallery-source', chatId: CHAT_ID, resource: this.resource, input: { hours: 8 }, result: { content: [{ type: 'text', text: 'The estimate is $960 for eight hours.' }], structuredContent: { total: 960 } }, revision: 0, legacy: false };
    }
    if (path === 'connectedApps.status') return { revision: this.revision };
    if (path === 'connectedApps.invoke') {
      const args = input.args as { hours: number };
      this.changed(`Example app recalculated ${args.hours} hours`);
      return { kind: 'result', result: { content: [{ type: 'text', text: 'Estimate updated' }], structuredContent: { total: args.hours * 120 } } };
    }
    if (path === 'connectedApps.context') { this.changed('The example app shared its selection with the example chat'); return this.revision; }
    if (path === 'connectedApps.cancel') return { cancelled: true };
    throw new Error(`The gallery has no fixture for ${path}`);
  }
}
