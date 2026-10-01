import { describe, expect, it } from 'vitest';
import { requestWorkbenchView, takeWorkbenchView } from './view-request';

describe('workbench view requests', () => {
  it('hands the view to its own chat once', () => {
    requestWorkbenchView('chat-a', 'changes');
    expect(takeWorkbenchView('chat-b')).toBeNull();
    expect(takeWorkbenchView('chat-a')).toBe('changes');
    expect(takeWorkbenchView('chat-a')).toBeNull();
  });

  it('keeps only the latest ask', () => {
    requestWorkbenchView('chat-a', 'changes');
    requestWorkbenchView('chat-b', 'files');
    expect(takeWorkbenchView('chat-a')).toBeNull();
    expect(takeWorkbenchView('chat-b')).toBe('files');
  });

  it('drops an ask nobody took in time, so it cannot open a panel later', () => {
    requestWorkbenchView('chat-a', 'changes');
    expect(takeWorkbenchView('chat-a', Date.now() + 60_000)).toBeNull();
    expect(takeWorkbenchView('chat-a')).toBeNull();
  });
});
