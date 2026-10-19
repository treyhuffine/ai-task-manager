import { randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/client';
import type { Attachment } from '@/db/types';
import type { prepareResource } from './resource';

export const VIEW_TTL = 30 * 60_000;
export const MAX_VIEWS = 32;
/** A captured result, and an app operation's result kept for a retried delivery. */
export const MAX_RESULT = 512 * 1024;
/** What one view keeps for retried deliveries, in total. */
export const MAX_RESULTS = 8 * 1024 * 1024;
/**
 * One app operation's result. Up to this size it is delivered, and only
 * results within `MAX_RESULT` are kept, so a duplicate of a larger one is
 * refused rather than replayed. Bits & Bolts reads model files of about 6 MB.
 */
export const MAX_DELIVERED_RESULT = 24 * 1024 * 1024;
/** What one view may receive in total, bounding a runaway app. */
export const MAX_DELIVERED = 512 * 1024 * 1024;
/**
 * Operations one view may run. A screen stays open up to 30 minutes, and
 * browsing a parts library reads a part per click, so this is generous. Each
 * keeps only a small receipt.
 */
export const MAX_CALLS = 2000;
/**
 * How a view came to exist. `result` is a model's tool result in a chat. The
 * rest are a person opening an app: a global screen, a tab beside a chat
 * (`thread`), a file's viewer, a settings button, or a form option's preview.
 */
export type CaptureKind = 'result' | 'global' | 'thread' | 'file' | 'settings' | 'preview';
export interface Capture {
  id: string; serverId: string; connectionId: string; sourceRef: string; authority: string;
  chatId?: string; viewerId?: string; tool: string; input: Record<string, unknown>;
  result: CallToolResult; resourceUri: string; legacy: boolean; title: string; created: number;
  kind?: CaptureKind;
  /** OpenAI's deep link: the app-relative URL a global screen shows (`hostContext["openai/deepLink"]`). */
  deepLink?: string;
  /** The opened file, for a file entrypoint: its host handle (`files.ts`) and display name. */
  file?: { handle: string; name: string };
}
export interface View {
  id: string; viewerId: string; capture: Capture; resource?: ReturnType<typeof prepareResource>;
  resourcePromise?: Promise<ReturnType<typeof prepareResource>>;
  created: number; bytes: number; delivered: number; reads?: number; context?: ModelContext; contextUpdateId?: string; revision: number; contextSecond: number; contextCount: number;
  /** The context's images and blobs, saved as attachments once per update (`context-files.ts`). */
  contextFiles?: { updateId?: string; source: ModelContext; context: ModelContext; files: Attachment[] };
  closed: boolean;
  calls: Map<string, {fingerprint?: string; retryable: boolean; cancelled: boolean; result?: Promise<ViewCall>}>;
}
export interface ApprovalWait { kind: 'approval'; ids: string[]; preview: unknown }
/** A view's model context: MCP content blocks and structured content, as `ui/update-model-context` sent them. */
export interface ModelContext { content: Record<string, unknown>[]; structuredContent?: Record<string, unknown> }
export type ViewCall = {kind: 'result'; result: CallToolResult} | ApprovalWait;

/** Small, ephemeral, Home-owned state. Never persists private result metadata. */
export class McpViewStore {
  captures = new Map<string, Capture>();
  views = new Map<string, View>();
  constructor(private now = Date.now, private dispose: (view: View) => void = () => {}) {}
  private dropView(id: string) {
    const view = this.views.get(id);
    this.views.delete(id);
    if (view) { view.closed = true; this.dispose(view); }
  }
  prune() {
    for (const [key, capture] of this.captures) if (capture.created + VIEW_TTL <= this.now()) this.captures.delete(key);
    for (const [key, view] of this.views) if (view.created + VIEW_TTL <= this.now()) this.dropView(key);
  }
  put(capture: Capture) {
    this.prune();
    if (Buffer.byteLength(JSON.stringify(capture.result)) > MAX_RESULT) return false;
    if (this.captures.size >= MAX_VIEWS) this.captures.delete(this.captures.keys().next().value!);
    this.captures.set(capture.id, capture);
    return true;
  }
  open(capture: Capture, viewerId: string) {
    this.prune();
    if (capture.created + VIEW_TTL <= this.now()) throw new Error('This interactive result has expired. Ask for a new result to open a new view.');
    const previous = [...this.views.values()].find(v => v.viewerId === viewerId && v.capture.id === capture.id);
    if (previous) return previous;
    if (this.views.size >= MAX_VIEWS) this.dropView(this.views.keys().next().value!);
    const view: View = {id: randomUUID(), viewerId, capture, created: capture.created, bytes: Buffer.byteLength(JSON.stringify(capture.result)), delivered: 0, revision: 0, contextSecond: 0, contextCount: 0, closed: false, calls: new Map()};
    this.views.set(view.id, view);
    return view;
  }
  get(id: string, viewerId: string) {
    this.prune();
    const view = this.views.get(id);
    if (!view || view.viewerId !== viewerId) throw new Error('This app view has expired or is unavailable');
    return view;
  }
  capture(id: string) {
    this.prune();
    const capture = this.captures.get(id);
    if (!capture) throw new Error('This interactive result has expired. Its text is still available. Ask for a new result to open a new view.');
    return capture;
  }
  async call(view: View, invocationId: string, fingerprint: string, execute: () => Promise<ViewCall>) {
    this.assertInvocation(view, invocationId);
    const previous = view.calls.get(invocationId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('This invocation ID already belongs to a different operation');
      if (!previous.retryable) return previous.result!;
    }
    if ((!previous && view.calls.size >= MAX_CALLS) || view.bytes >= MAX_RESULTS) throw new Error('This app view reached its operation limit. Open a new result to continue.');
    const promise = Promise.resolve().then(() => {this.assertInvocation(view, invocationId); return execute();}).then(result => {
      this.assertInvocation(view, invocationId);
      if (result.kind === 'approval') { view.calls.get(invocationId)!.retryable = true; return result; }
      const size = Buffer.byteLength(JSON.stringify(result));
      if (size > MAX_DELIVERED_RESULT || size + view.delivered > MAX_DELIVERED) throw new Error('The operation completed, but its result is too large for this view. It will not be replayed.');
      view.delivered += size;
      // A small result is kept so a duplicate delivery gets the same answer. A larger one is
      // delivered once: its receipt stays, so a duplicate is refused rather than run again.
      if (size <= MAX_RESULT && size + view.bytes <= MAX_RESULTS) view.bytes += size;
      else queueMicrotask(() => {
        const call = view.calls.get(invocationId);
        if (!call) return;
        const refused = Promise.reject(new Error('This operation already completed. Its result was delivered once and is not kept.'));
        refused.catch(() => {});
        call.result = refused;
      });
      return result;
    });
    // Keep failures as non-replayable receipts. A transport error may have followed an effect.
    view.calls.set(invocationId, {fingerprint, retryable: false, cancelled: false, result: promise});
    return promise;
  }
  isCancelled(view: View, invocationId: string) { return view.closed || view.calls.get(invocationId)?.cancelled === true; }
  assertInvocation(view: View, invocationId: string) {
    if (this.isCancelled(view, invocationId)) throw new Error('This app operation was cancelled');
  }
  cancel(view: View, invocationId: string) {
    const call = view.calls.get(invocationId);
    if (call) { call.cancelled = true; call.retryable = false; }
    else {
      if (view.calls.size >= MAX_CALLS) throw new Error('This app view reached its operation limit');
      // Cancellation can overtake the first invoke request. Keep a bounded
      // tombstone so a late delivery cannot start that operation afterward.
      view.calls.set(invocationId, {cancelled: true, retryable: false});
    }
  }
}
