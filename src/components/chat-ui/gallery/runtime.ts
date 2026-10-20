import { approvals, CHAT_ID, connectionResponse, CONNECTION_VIEW, DRAFT_ID, emailDraft, event, HANDOFF, HTML_DOCUMENT, mentionExample, NOW, pendingInput, RECORD_ID, VERSIONS } from './fixtures';
import type { ChatEventRecord, EmailDraft, WorkResultDecisionRecord } from '@/db/types';
import type { ChatUiExampleId } from './catalog';

/** An independent in-memory Home for a single sandboxed example. Never calls a real API. */
export class GalleryRuntime {
  email: EmailDraft;
  events: ChatEventRecord[] = [];
  pending;
  logs: string[] = [];
  private revision = 0;
  private listeners = new Set<() => void>();
  private decisions: WorkResultDecisionRecord[] = [];
  private versionRows = VERSIONS;
  constructor(readonly example: ChatUiExampleId, readonly state: string, readonly resource?: unknown) {
    this.email = emailDraft(state);
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
    this.decisions.unshift({ id: `decision-${this.decisions.length}`, createdAt: NOW, updatedAt: NOW, resultId: RECORD_ID, requestHash: 'gallery', userId: 'local', disposition, actorSource: 'human', actorUserId: 'local', actorSessionId: null, note: note ?? null, context: null, attachments: [], feedbackSessionId: CHAT_ID, feedbackMessageId: null });
  }
  async invoke(path: string, value: unknown): Promise<unknown> {
    const input = (value ?? {}) as Record<string, unknown>;
    const body = (input.body ?? {}) as Record<string, unknown>;
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
    if (path === 'sessions.prGet') return { pr: null };
    if (path === 'sessions.fileGet' && (input.query as { path?: string })?.path === 'review-plan.html') return { path: 'review-plan.html', content: HTML_DOCUMENT, encoding: 'utf8', mime: 'text/html', size: HTML_DOCUMENT.length, isBinary: false, tooLarge: false };
    if (path === 'sessions.pendingInputGet') return this.pending;
    if (path === 'sessions.pendingInputRequestIdPost') {
      this.pending = [];
      this.changed(body.answers ? `Example answer: ${Object.values(body.answers as object).join(' · ')}` : body.allow ? 'Example permission allowed' : 'Example permission declined');
      return { ok: true };
    }
    if (path === 'sessions.get') return { id: CHAT_ID, type: 'orchestration', status: 'active', harness: 'claude', execution: null, surfaceKind: null, workspaceId: null, scratchPad: '', userId: 'local', label: 'Gallery conversation', createdAt: NOW, updatedAt: NOW };
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
