'use client';

import { useQuery } from '@tanstack/react-query';
import { api, apiErrorText } from '@/lib/api/client';
import { HARNESS_IDS, type HarnessId } from '@/lib/harness/registry';
import type { HarnessVerifyResponse } from '@/app/api/harness/verify/route';
import type { HarnessAuthReport } from '@/components/onboarding/harness-setup';
import { autoHarness, suggestedHarness, type HarnessReports } from '@/components/onboarding/harness-pick';

export type HarnessCheck =
  | { status: 'ready'; harness: HarnessId; report: HarnessAuthReport }
  | { status: 'attention'; suggested: HarnessId; reports: HarnessReports; problem: string | null };

/**
 * The check behind the first run's harness step, started as soon as the
 * conversation opens so it's usually done before the step comes up: every
 * harness's sign-in at once (fast), then one real request to the one it can
 * set up without asking (a few seconds). Ready means the step finishes
 * silently. Anything else shows the picker with what was found.
 *
 * Cached for the page's life, so moving through the conversation never
 * repeats the round trip.
 */
export function useHarnessCheck(enabled: boolean) {
  return useQuery({
    queryKey: ['onboarding', 'harness-check'],
    queryFn: runHarnessCheck,
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

async function runHarnessCheck(): Promise<HarnessCheck> {
  const entries = await Promise.all(
    HARNESS_IDS.map(async (id) => {
      const report = await api.post<HarnessAuthReport>('/harness/auth', { harness: id }).catch(() => null);
      return [id, report] as const;
    }),
  );
  const reports: HarnessReports = Object.fromEntries(entries);
  const harness = autoHarness(reports);
  if (!harness) return { status: 'attention', suggested: suggestedHarness(reports), reports, problem: null };
  try {
    const verify = await api.post<HarnessVerifyResponse>('/harness/verify', { harness });
    if (verify.ok) return { status: 'ready', harness, report: reports[harness]! };
    return { status: 'attention', suggested: harness, reports, problem: verify.errorMessage ?? null };
  } catch (err) {
    return { status: 'attention', suggested: harness, reports, problem: apiErrorText(err) };
  }
}
