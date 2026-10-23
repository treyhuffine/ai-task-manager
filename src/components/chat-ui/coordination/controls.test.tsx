import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatCapabilities } from '../chat-capabilities';
import { CoordinationControls, CoordinationMenu, CoordinationSettings } from './controls';

it.each([CoordinationControls, CoordinationMenu, CoordinationSettings])('keeps personal coordination out of shared chats (%s)', Component => {
  // Deliberately omit a query provider. Disabled controls must not mount
  // personal data hooks, including when their surrounding menu is open.
  const html = renderToStaticMarkup(
    <ChatCapabilities.Provider value={{ deliveryReceipts: false, prepareResults: true, coordination: false }}>
      <Component sessionId="shared-chat" />
    </ChatCapabilities.Provider>,
  );
  expect(html).toBe('');
});
