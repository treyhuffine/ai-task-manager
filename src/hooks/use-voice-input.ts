'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { getVoiceProvider, DEFAULT_VOICE_MODEL } from '@/constants/voice-models';
import { useUserState } from '@/hooks/use-user-state';
import { authFetch } from '@/lib/api/client';

type VoiceProvider = 'local' | 'groq' | 'openai' | 'web' | null;

/**
 * How the browser will capture audio:
 *   - media-recorder: live mic via getUserMedia + MediaRecorder (secure contexts only)
 *   - web-speech:     browser's built-in SpeechRecognition (no server round-trip)
 *   - null:           nothing works; see `unsupportedReason` for why
 */
export type CaptureMode = 'media-recorder' | 'web-speech' | null;

// ─── State machine ──────────────────────────────────────────────
// Single source of truth for the recording lifecycle.
//   idle → starting → recording → stopping → transcribing → idle
//                              ↘ cancelling → idle
type VoiceStatus = 'idle' | 'starting' | 'recording' | 'stopping' | 'cancelling' | 'transcribing';

export interface ProviderStatus {
  local: { available: boolean; configured: boolean };
  groq: { available: boolean; configured: boolean };
  openai: { available: boolean; configured: boolean };
  web: { available: boolean; configured: boolean };
}

export interface UseVoiceInputReturn {
  /** Currently recording audio */
  isRecording: boolean;
  /** Transcribing the recording */
  isTranscribing: boolean;
  /** The transcribed text ready to send */
  transcript: string;
  /** Clear the current transcript */
  clearTranscript: () => void;
  /** Update transcript text (for inline editing) */
  setTranscript: (text: string) => void;
  /** Which STT provider is active */
  provider: VoiceProvider;
  /** Voice input is available (at least one provider + one capture mechanism) */
  isSupported: boolean;
  /** How audio will be captured — drives UI affordance (live mic vs. native picker) */
  captureMode: CaptureMode;
  /** Human-readable reason when voice is unavailable (captureMode === null) */
  unsupportedReason: string | null;
  /** Start recording */
  startRecording: () => void;
  /** Stop recording and begin transcription */
  stopRecording: () => void;
  /** Toggle recording on/off */
  toggleRecording: () => void;
  /** Cancel recording without transcribing */
  cancelRecording: () => void;
  /** The active MediaStream (for passing to LiveWaveform visualization) */
  stream: MediaStream | null;
  /** Error message if something went wrong */
  error: string | null;
  /** Provider availability status (from GET /api/transcribe) */
  providerStatus: ProviderStatus | null;
}

export function useVoiceInput(voiceModelOverride?: string): UseVoiceInputReturn {
  const { data: userState } = useUserState();
  const voiceModel = voiceModelOverride ?? userState?.voice_model ?? DEFAULT_VOICE_MODEL;

  // Status lives in a ref (source of truth for async callbacks) AND state
  // (triggers re-renders). `setVoiceStatus` is the ONLY way to update —
  // the raw state setter is deliberately hidden via destructure rename.
  const statusRef = useRef<VoiceStatus>('idle');
  const [status, _unsafeSetStatus] = useState<VoiceStatus>('idle');
  const setVoiceStatus = useCallback((next: VoiceStatus) => {
    statusRef.current = next;
    _unsafeSetStatus(next);
  }, []);

  const [transcript, setTranscript] = useState('');
  const [provider, setProvider] = useState<VoiceProvider>(null);
  const [captureMode, setCaptureMode] = useState<CaptureMode>(null);
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const isSupported = captureMode !== null;

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const voiceModelRef = useRef(voiceModel);
  voiceModelRef.current = voiceModel;

  // Web Speech API refs (fallback)
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const webTranscriptRef = useRef('');

  // Derived booleans — public API stays the same
  const isRecording = status === 'starting' || status === 'recording';
  const isTranscribing = status === 'transcribing';

  // Probe provider availability on mount
  useEffect(() => {
    let cancelled = false;

    // Capability detection — what the *browser* can do, independent of server providers.
    // getUserMedia requires a secure context (HTTPS or localhost). `capture` on a file
    // input does NOT, so it's our fallback for mobile-over-LAN-HTTP.
    const hasMediaRecorder =
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof window.MediaRecorder !== 'undefined';
    const hasWebSpeech =
      typeof window !== 'undefined' &&
      !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const isInsecureContext =
      typeof window !== 'undefined' && !window.isSecureContext;

    function resolve(status: ProviderStatus | null): {
      provider: VoiceProvider;
      mode: CaptureMode;
      reason: string | null;
    } {
      // Pick the best available server provider (user's choice → local → any).
      const selected = voiceModelRef.current
        ? (getVoiceProvider(voiceModelRef.current) as VoiceProvider)
        : null;
      let serverProvider: VoiceProvider = null;
      if (selected && selected !== 'web' && status?.[selected]?.available) {
        serverProvider = selected;
      } else if (status?.local?.available) {
        serverProvider = 'local';
      } else if (status?.groq?.available) {
        serverProvider = 'groq';
      } else if (status?.openai?.available) {
        serverProvider = 'openai';
      }

      // Server provider wins — but only if the browser can actually record live audio.
      if (serverProvider) {
        if (hasMediaRecorder) {
          return { provider: serverProvider, mode: 'media-recorder', reason: null };
        }
        // Server is ready but the browser can't capture audio (insecure origin).
        return {
          provider: serverProvider,
          mode: null,
          reason: isInsecureContext
            ? 'Voice requires HTTPS. Access this site over https:// (e.g. via Tailscale Serve) to enable the mic.'
            : 'This browser does not support audio recording.',
        };
      }

      // No server provider — try the browser's built-in recognition.
      if (hasWebSpeech) {
        return { provider: 'web', mode: 'web-speech', reason: null };
      }

      // Nothing works — diagnose which constraint to surface.
      if (isInsecureContext) {
        return {
          provider: null,
          mode: null,
          reason:
            'Voice requires HTTPS. Access this site over https:// (e.g. via Tailscale Serve) to enable the mic.',
        };
      }
      return {
        provider: null,
        mode: null,
        reason:
          'No speech-to-text provider available. Run `pnpm dev:stt` to start Parakeet, or configure GROQ_API_KEY / OPENAI_API_KEY.',
      };
    }

    async function probe() {
      let status: ProviderStatus | null = null;
      try {
        const res = await authFetch('/api/transcribe');
        const data = await res.json();
        if (cancelled) return;
        status = data.providers as ProviderStatus;
        setProviderStatus(status);
      } catch {
        // Probe failed — fall through with null status; resolve() handles it.
      }
      if (cancelled) return;

      const { provider: p, mode, reason } = resolve(status);
      setProvider(p);
      setCaptureMode(mode);
      setUnsupportedReason(reason);
    }

    probe();
    return () => { cancelled = true; };
  }, [voiceModel]);

  // ─── Mic lifecycle helpers ──────────────────────────────────
  const stopMic = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  // Helper — reads status without triggering TS control-flow narrowing
  const getStatus = useCallback(() => statusRef.current, []);

  // ─── Server-side transcription: record audio, POST to /api/transcribe ──
  const startServerTranscription = useCallback(async () => {
    // Guard: only start from idle
    if (getStatus() !== 'idle') return;
    setVoiceStatus('starting');
    setError(null);

    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      // If cancelled/stopped during getUserMedia, clean up and bail
      if (getStatus() !== 'starting') {
        mic.getTracks().forEach(t => t.stop());
        return;
      }

      streamRef.current = mic;
      setStream(mic);

      chunksRef.current = [];
      const recorder = new MediaRecorder(mic, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        chunksRef.current = [];
        mediaRecorderRef.current = null;

        // Kill the mic — we own it, not LiveWaveform
        stopMic();

        // Read the CURRENT status to decide what to do
        if (getStatus() === 'cancelling') {
          setVoiceStatus('idle');
          return;
        }

        // stopping → transcribe
        if (blob.size === 0) {
          setVoiceStatus('idle');
          return;
        }

        setVoiceStatus('transcribing');

        try {
          const form = new FormData();
          form.append('file', blob, 'recording.webm');
          if (voiceModelRef.current) {
            form.append('voice_model', voiceModelRef.current);
          }
          const res = await authFetch('/api/transcribe', { method: 'POST', body: form });
          const data = await res.json();

          if (res.ok && data.text) {
            setTranscript(prev => prev ? `${prev} ${data.text}` : data.text);
          } else {
            setError(data.error ?? 'Transcription failed');
          }
        } catch (err) {
          setError(`Transcription error: ${err}`);
        } finally {
          setVoiceStatus('idle');
        }
      };

      recorder.start(250);
      setVoiceStatus('recording');
    } catch (err) {
      stopMic();
      setVoiceStatus('idle');
      setError(`Microphone error: ${err}`);
    }
  }, [stopMic, setVoiceStatus, getStatus]);

  const stopServerTranscription = useCallback(() => {
    if (getStatus() !== 'recording') return;
    setVoiceStatus('stopping');

    const recorder = mediaRecorderRef.current;
    if (recorder?.state === 'recording') {
      // Flush buffered audio, then stop after pipeline drains
      recorder.requestData();
      // Capture this specific recorder — don't use the ref in the timeout,
      // or a quick start→stop→start could stop the wrong recorder
      setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }, 500);
    } else {
      stopMic();
      setVoiceStatus('idle');
    }
  }, [stopMic, setVoiceStatus, getStatus]);

  // Cancel recording — discard audio, no transcription.
  // Handles both server-side (MediaRecorder) and Web Speech paths.
  const cancelRecording = useCallback(() => {
    const s = getStatus();
    if (s !== 'recording' && s !== 'starting') return;

    // Server path: stop recorder, onstop reads 'cancelling' and discards
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === 'recording') {
      setVoiceStatus('cancelling');
      recorder.stop();
      return;
    }

    // Web Speech path: abort discards pending results (unlike stop which delivers them)
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    // Clean up mic ('starting' state) and reset
    stopMic();
    setVoiceStatus('idle');
  }, [stopMic, setVoiceStatus, getStatus]);

  // ─── Web Speech API fallback ─────────────────────────────

  const startWeb = useCallback(() => {
    if (getStatus() !== 'idle') return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;

    setError(null);
    if (recognitionRef.current) recognitionRef.current.abort();

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    webTranscriptRef.current = '';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let text = '';
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          text += event.results[i][0].transcript;
        }
      }
      if (text.trim()) {
        webTranscriptRef.current = webTranscriptRef.current
          ? `${webTranscriptRef.current} ${text.trim()}`
          : text.trim();
        setTranscript(webTranscriptRef.current);
      }
    };

    recognition.onend = () => {
      setVoiceStatus('idle');
      recognitionRef.current = null;
    };

    recognition.onerror = (event: Event) => {
      // abort() fires an 'aborted' error — that's intentional cancel, not a real error
      if ((event as Event & { error?: string }).error === 'aborted') return;
      console.error('[Voice] Web Speech error:', event);
      setError('Speech recognition error');
      setVoiceStatus('idle');
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setVoiceStatus('recording');
  }, [setVoiceStatus, getStatus]);

  const stopWeb = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  // ─── Unified controls ────────────────────────────────────

  const startRecording = useCallback(() => {
    if (provider === 'web') {
      startWeb();
    } else if (provider) {
      // local, groq, openai — all use server-side transcription
      startServerTranscription();
    }
  }, [provider, startServerTranscription, startWeb]);

  const stopRecording = useCallback(() => {
    if (provider === 'web') {
      stopWeb();
    } else if (provider) {
      stopServerTranscription();
    }
  }, [provider, stopServerTranscription, stopWeb]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const clearTranscript = useCallback(() => {
    setTranscript('');
    setError(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      if (recognitionRef.current) recognitionRef.current.abort();
    };
  }, []);

  return {
    isRecording,
    isTranscribing,
    transcript,
    clearTranscript,
    setTranscript,
    provider,
    isSupported,
    captureMode,
    unsupportedReason,
    startRecording,
    stopRecording,
    toggleRecording,
    cancelRecording,
    stream,
    error,
    providerStatus,
  };
}
