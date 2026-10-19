import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatEventRecord } from '@/db/types';
import { toChatEventDTO } from '@/lib/api/dto/chat-event';
import { MCP_FORM_RESPONSE_EVENT } from '@/lib/mcp-apps/form-events';
import { ConnectedFormOutcome } from './form-outcome';

/** A form's recorded end as the Home stores it, read back the way a reloaded transcript gets it. */
const reloaded = (raw: Record<string, unknown>) => {
  const event = toChatEventDTO({ id: 'event', sessionId: 'chat', role: 'system', source: 'system', content: MCP_FORM_RESPONSE_EVENT,
    raw: { subtype: MCP_FORM_RESPONSE_EVENT, ...raw } } as ChatEventRecord);
  return renderToStaticMarkup(createElement(ConnectedFormOutcome, { raw: event.raw }));
};

describe('a form\'s outcome after the transcript reloads', () => {
  it('says how the form ended and which app asked', () => {
    expect(reloaded({ formId: 'form', outcome: 'accepted', app: 'Bits & Bolts' })).toContain('You answered Bits &amp; Bolts&#x27;s form');
    expect(reloaded({ formId: 'form', outcome: 'declined', app: 'Bits & Bolts' })).toContain('You declined Bits &amp; Bolts&#x27;s form');
    expect(reloaded({ formId: 'form', outcome: 'expired', app: 'Bits & Bolts' })).toContain('Bits &amp; Bolts&#x27;s form waited too long and closed');
  });

  it('keeps the reason a form could not show', () => {
    expect(reloaded({ outcome: 'unsupported', app: 'Bits & Bolts', reason: 'It asks for a file upload' }))
      .toContain('Bits &amp; Bolts asked for a form Ri cannot show. It asks for a file upload');
  });
});
