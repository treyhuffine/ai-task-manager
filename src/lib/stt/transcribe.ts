/**
 * Shared speech-to-text transcription logic.
 *
 * Used by both `/api/transcribe` (browser voice input) and
 * `/api/capture` (automation / iOS Shortcuts).
 *
 * Providers: Parakeet local (Docker sidecar) and Groq cloud, plus the
 * browser's own Web Speech API on the client. OpenAI STT was removed
 * deliberately — the only OpenAI API use in the app is embeddings.
 */

import { assertPersonalCapability } from '@/lib/home/authority';
import { managedSpeech, speechPreferences } from './managed/manager';
import { getVoiceProvider, getVoiceModelName, isKnownVoiceModel } from '@/constants/voice-models';

const LOCAL_STT_URL = process.env.LOCAL_SPEECH_TO_TEXT_URL ?? 'http://localhost:5092';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ─── Provider health ─────────────────────────────────────────

export async function isLocalAvailable(): Promise<boolean> {
  if (speechPreferences().enabled) {
    const status = managedSpeech().status();
    return status.installed && status.helperAvailable && status.phase !== 'error';
  }
  try {
    const res = await fetch(`${LOCAL_STT_URL}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

export interface ProviderStatus {
  local: { available: boolean; configured: boolean; managedModel?: string };
  groq: { available: boolean; configured: boolean };
  web: { available: boolean; configured: boolean };
}

export async function getProviderStatus(): Promise<ProviderStatus> {
  const localAvailable = await isLocalAvailable();
  return {
    local: { available: localAvailable, configured: true, ...(speechPreferences().enabled ? { managedModel: 'local/parakeet-tdt-0.6b-v3' } : {}) },
    groq: { available: !!GROQ_API_KEY, configured: !!GROQ_API_KEY },
    // Only the client can establish its browser recognition capability.
    web: { available: false, configured: false },
  };
}

/** Pick the first available STT provider. Returns a full model ID. */
export async function pickProvider(): Promise<string> {
  if (await isLocalAvailable()) return 'local/parakeet-tdt-0.6b-v3';
  if (GROQ_API_KEY && speechPreferences().cloudFallback) return 'groq/whisper-large-v3-turbo';
  throw new Error('No local speech provider available. Choose Groq explicitly or allow automatic Groq fallback in Voice settings.');
}

/**
 * Resolve a preferred voice model to one that is actually usable: unknown
 * or removed ids (e.g. a stored `openai/*` model from before OpenAI STT
 * was removed) fall through to auto-pick. Throws when nothing is
 * available, same as `pickProvider`.
 */
export async function resolveVoiceModel(preferred: string | null | undefined): Promise<string> {
  if (preferred && isKnownVoiceModel(preferred)) return preferred;
  return pickProvider();
}

// ─── Transcription ───────────────────────────────────────────

/**
 * Transcribe an audio blob using the given voice model ID
 * (format: "provider/model-name").
 */
export async function transcribe(
  file: Blob,
  voiceModel: string,
  signal?: AbortSignal,
): Promise<string> {
  // A team space runs no AI, speech-to-text included (docs/homes-spec.md §9.2).
  assertPersonalCapability('Speech to text');
  const provider = getVoiceProvider(voiceModel);
  const modelName = getVoiceModelName(voiceModel);

  const form = new FormData();
  form.append('file', file);
  form.append('model', modelName);
  form.append('response_format', 'json');

  switch (provider) {
    case 'local': {
      if (speechPreferences().enabled) {
        if (voiceModel !== 'local/parakeet-tdt-0.6b-v3') throw new Error('Managed local speech includes Parakeet V3 INT8. Choose Parakeet V3, or disable managed speech to use another model on an external service.');
        return managedSpeech().transcribe(file, signal);
      }
      const available = await isLocalAvailable();
      if (!available) throw new Error('Local speech recognition is unavailable. Start the configured Parakeet server or choose Groq in Voice settings.');
      const res = await fetch(`${LOCAL_STT_URL}/v1/audio/transcriptions`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5 * 60_000)]),
      });
      if (!res.ok) throw new Error(`Local STT error ${res.status}: ${await res.text()}`);
      return (await res.json()).text ?? '';
    }
    case 'groq': {
      if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');
      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
        body: form,
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5 * 60_000)]),
      });
      if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
      return (await res.json()).text ?? '';
    }
    case 'web':
      throw new Error('Web speech recognition is handled in the browser');
    case 'openai':
      throw new Error(
        'OpenAI speech-to-text was removed. Pick Parakeet (local) or Groq in Settings → Voice.',
      );
    default:
      throw new Error(`Unknown voice provider: ${provider}`);
  }
}
