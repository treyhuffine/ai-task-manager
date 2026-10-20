import { randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/client';
import type { Attachment } from '@/db/types';
import { VIEW_CLOSED_MESSAGE } from './metadata';

/**
 * Captures and view sessions kept in memory, each. The least recently used
 * goes first. A model's result is also stored (`mcp_tool_results`), so it
 * opens again after it leaves memory or the Home restarts: a result's card
 * opens only near the screen, polls only there, and opens its view again
 * quietly when it finds it gone (`ConnectedView`). A screen the
 * person opened lives only here: once it goes, opening the app starts it over.
 * No interface is kept: a view reads its `ui://` resource each time it opens.
 */
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
/**
 * Receipts one view keeps, so a retried delivery gets the same answer and a
 * cancelled one never starts. Past this the oldest goes: retries come within
 * moments, and a screen may stay open all day.
 */
export const MAX_CALLS = 2000;
/**
 * How a view came to exist. `result` is a model's tool result in a chat. The
 * rest are a person opening an app: a global screen, a tab beside a chat
 * (`thread`), a file's viewer, a settings button, or a form option's preview.
 */
export type CaptureKind = 'result' | 'global' | 'thread' | 'file' | 'settings' | 'preview';
export interface Capture {
  id: string; serverId: string; connectionId: string; sourceRef: string;
  chatId?: string; viewerId?: string; tool: string; input: Record<string, unknown>;
  result: CallToolResult; resourceUri: string; legacy: boolean; title: string; created: number;
  kind?: CaptureKind;
  /** OpenAI's deep link: the app-relative URL a global screen shows (`hostContext["openai/deepLink"]`). */
  deepLink?: string;
  /** The opened file, for a file entrypoint: its host handle (`files.ts`) and display name. */
  file?: { handle: string; name: string };
}
interface CallReceipt { fingerprint?: string; retryable: boolean; cancelled: boolean; result?: Promise<ViewCall>; kept?: number }
export interface View {
  id: string; viewerId: string; capture: Capture;
  created: number; bytes: number; context?: ModelContext; contextUpdateId?: string; revision: number; contextSecond: number; contextCount: number;
  /** The context's images and blobs, saved as attachments once per update (`context-files.ts`). */
  contextFiles?: { updateId?: string; source: ModelContext; context: ModelContext; files: Attachment[] };
  closed: boolean;
  calls: Map<string, CallReceipt>;
}
export interface ApprovalWait { kind: 'approval'; ids: string[]; preview: unknown }
/** A view's model context: MCP content blocks and structured content, as `ui/update-model-context` sent them. */
export interface ModelContext { content: Record<string, unknown>[]; structuredContent?: Record<string, unknown> }
export type ViewCall = {kind: 'result'; result: CallToolResult} | ApprovalWait;

/** A map that keeps its most recently used entry last, so the first is the one to drop. */
function touch<K, V>(map: Map<K, V>, key: K, value: V) { map.delete(key); map.set(key, value); }

/** Home-owned state for connected app views, in memory. A stored model result comes back through `put` (`service.ts`). */
export class McpViewStore {
  captures = new Map<string, Capture>();
  views = new Map<string, View>();
  constructor(private dispose: (view: View) => void = () => {}) {}
  private dropView(id: string) {
    const view = this.views.get(id);
    this.views.delete(id);
    if (view) { view.closed = true; this.dispose(view); }
  }
  put(capture: Capture) {
    if (Buffer.byteLength(JSON.stringify(capture.result)) > MAX_RESULT) return false;
    if (!this.captures.has(capture.id) && this.captures.size >= MAX_VIEWS) this.captures.delete(this.captures.keys().next().value!);
    touch(this.captures, capture.id, capture);
    return true;
  }
  open(capture: Capture, viewerId: string) {
    const previous = [...this.views.values()].find(v => v.viewerId === viewerId && v.capture.id === capture.id);
    if (previous) { touch(this.views, previous.id, previous); return previous; }
    if (this.views.size >= MAX_VIEWS) this.dropView(this.views.keys().next().value!);
    const view: View = {id: randomUUID(), viewerId, capture, created: capture.created, bytes: Buffer.byteLength(JSON.stringify(capture.result)), revision: 0, contextSecond: 0, contextCount: 0, closed: false, calls: new Map()};
    this.views.set(view.id, view);
    return view;
  }
  get(id: string, viewerId: string) {
    const view = this.views.get(id);
    if (!view || view.viewerId !== viewerId) throw new Error(VIEW_CLOSED_MESSAGE);
    touch(this.views, id, view);
    return view;
  }
  /** A capture still in memory, or undefined. */
  kept(id: string) {
    const kept = this.captures.get(id);
    if (kept) touch(this.captures, id, kept);
    return kept;
  }
  /** Make room for one more receipt: the oldest goes, and what it kept no longer counts against the view. */
  private roll(view: View) {
    while (view.calls.size >= MAX_CALLS) {
      const [oldest, receipt] = view.calls.entries().next().value!;
      view.calls.delete(oldest);
      view.bytes -= receipt.kept ?? 0;
    }
  }
  async call(view: View, invocationId: string, fingerprint: string, execute: () => Promise<ViewCall>) {
    this.assertInvocation(view, invocationId);
    const previous = view.calls.get(invocationId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('This invocation ID already belongs to a different operation');
      if (!previous.retryable) return previous.result!;
    } else this.roll(view);
    const receipt: CallReceipt = {fingerprint, retryable: false, cancelled: false};
    const promise = Promise.resolve().then(() => {this.assertInvocation(view, invocationId); return execute();}).then(result => {
      this.assertInvocation(view, invocationId);
      if (result.kind === 'approval') { receipt.retryable = true; return result; }
      const size = Buffer.byteLength(JSON.stringify(result));
      if (size > MAX_DELIVERED_RESULT) throw new Error('The operation completed, but its result is too large for this view. It will not be replayed.');
      // A small result is kept so a duplicate delivery gets the same answer. A larger one is
      // delivered once: its receipt stays, so a duplicate is refused rather than run again.
      if (size <= MAX_RESULT && size + view.bytes <= MAX_RESULTS) { view.bytes += size; receipt.kept = size; }
      else queueMicrotask(() => {
        if (view.calls.get(invocationId) !== receipt) return;
        const refused = Promise.reject(new Error('This operation already completed. Its result was delivered once and is not kept.'));
        refused.catch(() => {});
        receipt.result = refused;
      });
      return result;
    });
    // Keep failures as non-replayable receipts. A transport error may have followed an effect.
    receipt.result = promise;
    view.calls.set(invocationId, receipt);
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
      // Cancellation can overtake the first invoke request. Keep a tombstone
      // so a late delivery cannot start that operation afterward.
      this.roll(view);
      view.calls.set(invocationId, {cancelled: true, retryable: false});
    }
  }
}
