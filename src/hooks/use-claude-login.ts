'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { ClaudeAuthStatus } from '@/lib/auth/claude';

interface ClaudeLoginResponse {
  ok: boolean;
  status: ClaudeAuthStatus;
}

const STATUS_KEY = ['claude-auth-status'] as const;

/**
 * Live "is the user logged in to Claude?" signal. Drives whether the
 * `auth_required` banner renders an actionable button or just sits as
 * historical record.
 *
 * Polls every 30s as a safety net. Refetches on mount (so opening a chat
 * picks up an out-of-band login from another terminal) and on window
 * focus. Mutated immediately by `useClaudeLogin` on success — the next
 * banner render reads the fresh value with no extra round-trip.
 *
 * Returns the full `ClaudeAuthStatus` so consumers can show the email /
 * subscription type as well if useful.
 */
export function useClaudeAuthStatus() {
  return useQuery<ClaudeAuthStatus>({
    queryKey: STATUS_KEY,
    queryFn: () => api.get<ClaudeAuthStatus>('/claude-auth/status'),
    // Polling cadence. Costs one cheap subprocess spawn per tick
    // (`claude auth status` returns instantly from the credential
    // file/keychain). 10s is the sweet spot — out-of-band logins from
    // another terminal surface fast enough that a user who already
    // re-authed sees the banner morph before they get suspicious.
    // The login mutation also writes the new status straight into the
    // cache, so the inline flow doesn't depend on the poll at all.
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    // Multiple banners + the recovery card on the same page share one
    // network response within this window.
    staleTime: 3_000,
  });
}

/**
 * Drives the "Log in to Claude" button rendered inside an `auth_required`
 * chat_event. POSTs the login route — the server handles spawning
 * `claude auth login` and polling for completion. Resolves when the user
 * finishes the OAuth flow in their browser (or fails on timeout).
 *
 * On success we eagerly write the new status into the cache so the
 * banner morphs to "Resend" instantly without waiting for the next poll
 * tick.
 */
export function useClaudeLogin() {
  const qc = useQueryClient();
  return useMutation<ClaudeLoginResponse, Error>({
    mutationFn: () => api.post<ClaudeLoginResponse>('/claude-auth/login'),
    onSuccess: (data) => {
      qc.setQueryData<ClaudeAuthStatus>(STATUS_KEY, data.status);
    },
  });
}
