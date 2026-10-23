'use client';
import { createContext, useContext, type ReactNode } from 'react';
const SourceHome = createContext<string | null>(null);
/** Canonical entity IDs in a shared body belong to its source Home. */
export function EntityLinkScope({ homeId, children }: { homeId: string; children: ReactNode }) {
  return <SourceHome.Provider value={homeId}>{children}</SourceHome.Provider>;
}
export function useEntityLinkHome() { return useContext(SourceHome); }
