'use client';

/**
 * The browser's side of getting into a team (docs/homes-spec.md §3.1): what a
 * link opens, joining, signing in elsewhere, finishing setup, and keeping
 * the member's key. The grant routes are public and the grant is the
 * credential, so these are plain requests, never the signed-in client.
 */

import { clearAuthToken, setAuthToken } from '@/lib/api/client';
import { API_PROTOCOL, API_PROTOCOL_HEADER } from '@/lib/releases/api-contract';
import type { TeamLinkKind } from './links';

export interface GrantPreview {
  kind: 'team';
  state: 'valid' | 'expired' | 'used' | 'revoked' | 'unknown';
  team: { id: string; name: string } | null;
  member: { name: string } | null;
  expiresAt: string | null;
}

export interface Admitted {
  token: string;
  member: { id: string; name: string; role: 'owner' | 'member' };
  team: { id: string; name: string; members: number; hostedOn: string | null };
}

export class TeamRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TeamRequestError';
  }
}

/** Couldn't reach the team at all: keep the link and offer Retry. */
export class TeamUnreachableError extends Error {
  constructor() {
    super("Ri couldn't reach this team. Check your connection and try again.");
    this.name = 'TeamUnreachableError';
  }
}

async function send<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', [API_PROTOCOL_HEADER]: String(API_PROTOCOL) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new TeamUnreachableError();
  }
  const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!response.ok) {
    throw new TeamRequestError(response.status, payload.error ?? 'failed', payload.message ?? 'Something went wrong. Try again.');
  }
  return payload as T;
}

export function previewTeamLink(kind: TeamLinkKind, secret: string): Promise<GrantPreview> {
  return send('/api/team/public/preview', { kind, secret, ...(kind === 'setup' ? { attemptId: readSetupAttempt(secret)?.attemptId } : {}) });
}

export function teamInfo(): Promise<{ kind: 'team'; ready: boolean }> {
  return send('/api/team/public/info');
}

/** What this browser is, as a label for the member's list of sign-ins. */
function thisDevice(): { kind: 'phone' | 'tablet' | 'computer' | 'other' } {
  const ua = navigator.userAgent;
  if (/iPhone|Android.+Mobile/i.test(ua)) return { kind: 'phone' };
  if (/iPad|Tablet/i.test(ua)) return { kind: 'tablet' };
  return { kind: /Electron/i.test(ua) ? 'computer' : 'other' };
}

export function joinTeam(secret: string, name: string): Promise<Admitted> {
  return send('/api/team/public/join', { secret, name, device: thisDevice() });
}

export function signInToTeam(secret: string): Promise<Admitted> {
  return send('/api/team/public/sign-in', { secret, device: thisDevice() });
}

export function finishTeamSetup(secret: string, teamName: string, ownerName: string): Promise<Admitted> {
  const attempt = { attemptId: readSetupAttempt(secret)?.attemptId ?? crypto.randomUUID(), teamName, ownerName };
  // Persist before sending: a lost response or reload must retry the same
  // private attempt. If storage fails, no owner has been created yet.
  try {
    localStorage.setItem(`ri:team-setup:${secret}`, JSON.stringify(attempt));
  } catch {
    throw new TeamRequestError(400, 'storage_unavailable', 'Allow this browser to keep site data before creating the team, so you can recover if the connection drops.');
  }
  return send('/api/team/public/setup', { secret, ...attempt, device: thisDevice() });
}

export function readSetupAttempt(secret: string): { attemptId: string; teamName: string; ownerName: string } | null {
  try {
    const value = JSON.parse(localStorage.getItem(`ri:team-setup:${secret}`) ?? 'null');
    return value && typeof value.attemptId === 'string' && /^[A-Za-z0-9_-]{32,80}$/.test(value.attemptId) && typeof value.teamName === 'string' && typeof value.ownerName === 'string' ? value : null;
  } catch { return null; }
}

/**
 * Keep the member's key for this team: in this origin's storage for the app's
 * requests, and in the team's own cookie for images and downloads.
 */
export async function keepTeamSignIn(token: string): Promise<void> {
  setAuthToken(token);
  await fetch('/api/session', { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
}

export function forgetTeamSignIn(): void {
  clearAuthToken();
  void fetch('/api/session', { method: 'DELETE' }).catch(() => {});
}
