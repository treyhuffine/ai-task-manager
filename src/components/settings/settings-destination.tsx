'use client';

import { createContext, useContext, useMemo } from 'react';
import { openSettings } from './settings-store';
import type { SectionId } from './settings-sections';

export type SettingsDestination = (section?: SectionId, options?: { anchor?: string }) => (() => void) | null;
const Context = createContext<SettingsDestination | null>(null);
export const SettingsDestinationProvider = Context.Provider;

/** A shared control can offer only a destination its owning document supplies. */
export function useSettingsLink(section?: SectionId, options: { anchor?: string } = {}) {
  const resolve = useContext(Context);
  const anchor = options.anchor;
  return useMemo(() => resolve ? resolve(section, { anchor }) : () => openSettings(section, { anchor }), [resolve, section, anchor]);
}
