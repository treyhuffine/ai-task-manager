/**
 * User preference for the local speech-to-text sidecar.
 * Stored in `~/.<APP_SHORT_ID>/config.json` (the same file as auth/onboarded
 * state). Kept behind a predicate so storage or defaults can evolve without
 * changing call sites.
 */

import { readAuthConfig, writeAuthConfig } from '@/lib/auth/config-file';

export function getVoiceEnabled(): boolean {
  return readAuthConfig()?.voiceEnabled === true;
}

export function setVoiceEnabled(enabled: boolean): void {
  writeAuthConfig({ voiceEnabled: enabled });
}

export function hasVoicePreference(): boolean {
  const v = readAuthConfig()?.voiceEnabled;
  return v === true || v === false;
}
