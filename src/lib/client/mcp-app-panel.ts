'use client';
import { createContext, useContext } from 'react';

/** Chat navigation only. Text mentions do not import or load the UI renderer. */
export const ConnectedCompanionContext = createContext<{
  captureId: string | null;
  open: (id: string | null) => void;
  mount: HTMLDivElement | null;
  register: (id: string) => () => void;
} | null>(null);
export const useConnectedCompanion = () => useContext(ConnectedCompanionContext);
