'use client';
import { useOptionalHomeContext } from './home-context';

/** Resolve host-local services once, independently of the individual surface. */
export function usePersonalServices() {
  const home = useOptionalHomeContext();
  return home ? home.capabilities.personalServices ?? home.home.kind === 'personal' : true;
}
