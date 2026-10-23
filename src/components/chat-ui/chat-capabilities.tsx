'use client';

import { createContext, useContext } from 'react';

/** Contextual interactions around the common transcript, independent of its data transport. */
export const ChatCapabilities = createContext<{ deliveryReceipts: boolean; prepareResults: boolean; coordination?: boolean }>({ deliveryReceipts: true, prepareResults: true });
export const useChatCapabilities = () => useContext(ChatCapabilities);
