'use client';

import { createContext, useContext, useMemo } from 'react';
import { useOptionalDashboard } from '@/contexts/dashboard-context';
import { closeSettings } from '@/components/settings/settings-store';

/** Destinations and controls belong to the document presenting the library. */
export interface SkillNavigation {
  openSkill: (ref: string, options?: { replace?: boolean }) => void;
  goHome: () => void;
  closeCatalog: () => void;
  canManage: boolean;
  showSetupHelp: boolean;
}
const Context = createContext<SkillNavigation | null>(null);
export const SkillNavigationProvider = Context.Provider;

export function useSkillNavigation(): SkillNavigation {
  const contextual = useContext(Context);
  const dashboard = useOptionalDashboard();
  const personal = useMemo(() => dashboard ? {
    openSkill: dashboard.openSkill, goHome: dashboard.goHome,
    closeCatalog: closeSettings, canManage: true, showSetupHelp: true,
  } : null, [dashboard]);
  const value = contextual ?? personal;
  if (!value) throw new Error('A skill library requires its document navigation.');
  return value;
}
