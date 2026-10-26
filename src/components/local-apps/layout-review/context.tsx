'use client';

import { createContext, useContext } from 'react';
import type { AppsReview } from '@/hooks/use-apps-layout-review';
export const AppsReviewContext = createContext<AppsReview | null>(null);
export function useReview() {
  const value = useContext(AppsReviewContext);
  if (!value) throw new Error('Apps layouts need the shared review controller.');
  return value;
}
