import { terminalTRPCClient } from '@/lib/trpc/client';
import type { PageSubscription } from './page-feed';

/** The PageStream consumes the same events and cursors over the authenticated socket. */
export interface PageStreamSource {
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
  onerror: ((event: Event) => void) | null;
}

class SharedPageSource extends EventTarget implements PageStreamSource {
  onerror: ((event: Event) => void) | null = null;
  private closed = false;
  private unsubscribe = () => {};
  constructor(url: string) {
    super();
    // Listeners are installed synchronously by PageStream before a socket
    // can deliver its initial state, including in an in-memory transport.
    queueMicrotask(() => {
      if (this.closed) return;
      try {
        const input = JSON.parse(new URL(url, 'http://page.invalid').searchParams.get('sub') ?? '{}') as PageSubscription;
        const subscription = terminalTRPCClient.live.output.subscribe(input, {
          onData: frame => { if (!this.closed) this.dispatchEvent(new MessageEvent(frame.event, { data: JSON.stringify(frame.data) })); },
          onError: () => { if (!this.closed) this.onerror?.(new Event('error')); },
        });
        this.unsubscribe = () => subscription.unsubscribe();
      } catch { if (!this.closed) this.onerror?.(new Event('error')); }
    });
  }
  close() { this.closed = true; this.unsubscribe(); }
}

export function openSharedPageSource(url: string): PageStreamSource { return new SharedPageSource(url); }
