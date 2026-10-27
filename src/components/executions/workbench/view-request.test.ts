import { describe, expect, it } from 'vitest';
import { hasWorkbenchView, requestWorkbenchView, takeWorkbenchView } from './view-request';

describe('workbench view requests', () => {
  it('hands the view to its own chat once', () => {
    requestWorkbenchView('chat-a', 'changes');
    expect(takeWorkbenchView('chat-b')).toBeNull();
    expect(takeWorkbenchView('chat-a')).toEqual({ view: 'changes' });
    expect(takeWorkbenchView('chat-a')).toBeNull();
  });

  it('keeps only the latest ask', () => {
    requestWorkbenchView('chat-a', 'changes');
    requestWorkbenchView('chat-b', 'files');
    expect(takeWorkbenchView('chat-a')).toBeNull();
    expect(takeWorkbenchView('chat-b')).toEqual({ view: 'files' });
  });

  it('drops an ask nobody took in time, so it cannot open a panel later', () => {
    requestWorkbenchView('chat-a', 'changes');
    expect(takeWorkbenchView('chat-a', Date.now() + 60_000)).toBeNull();
    expect(takeWorkbenchView('chat-a')).toBeNull();
  });

  it('carries the file to show in Files', () => {
    requestWorkbenchView('chat-a', 'files', 'src/app.ts');
    expect(takeWorkbenchView('chat-a')).toEqual({ view: 'files', path: 'src/app.ts' });
  });

  it('says whether a chat has an ask waiting without taking it', () => {
    requestWorkbenchView('chat-a', 'changes');
    expect(hasWorkbenchView('chat-b')).toBe(false);
    expect(hasWorkbenchView('chat-a')).toBe(true);
    expect(hasWorkbenchView('chat-a')).toBe(true);
    expect(hasWorkbenchView('chat-a', Date.now() + 60_000)).toBe(false);
    expect(takeWorkbenchView('chat-a')).toBeNull();
  });
});
