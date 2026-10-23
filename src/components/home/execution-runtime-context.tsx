'use client';

import { useOptionalHomeContext } from './home-context';

export function useExecutionRuntimeScope() {
  const home = useOptionalHomeContext();
  return { personalControls: home?.capabilities.privatePlanning ?? true, canConfigureModels: home?.capabilities.manageSignIns ?? true, canConfigureAgents: home?.capabilities.configureAgents ?? true };
}
