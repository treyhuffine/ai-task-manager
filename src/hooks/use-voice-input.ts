'use client';
import { trpcClient } from '@/lib/trpc/client';

import { DEFAULT_VOICE_MODEL, getVoiceProvider } from '@/constants/voice-models';
import { useUserState } from '@/hooks/use-user-state';
import { api } from '@/lib/api/client';
import { retainActiveInput } from '@/lib/client/active-input';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

type VoiceProvider = 'local' | 'groq' | 'web' | null;

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
  local: { available: boolean; configured: boolean; managedModel?: string };
  groq: { available: boolean; configured: boolean };
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
  /** Discard a recording or cancel an in-flight transcription */
  cancelRecording: () => void;
  /** The active MediaStream (for passing to LiveWaveform visualization) */
  stream: MediaStream | null;
  /** Error message if something went wrong */
  error: string | null;
  /** Provider availability status (from GET /api/transcribe) */
  providerStatus: ProviderStatus | null;
}

/**
 * One provider probe for every composer on the page, reused for a minute.
 * Each composer probed on its own, twice as its voice model loaded, and on a
 * plain-HTTP connection those probes queued behind the page's streams
 * (gate B finding).
 */
const PROVIDERS_KEY = ['transcribe', 'providers'] as const;
const PROVIDERS_FRESH_MS = 60_000;

export function useVoiceInput(voiceModelOverride?: string): UseVoiceInputReturn {
  const queryClient = useQueryClient();
  const { data: userState } = useUserState();
  const voiceModel = voiceModelOverride ?? userState?.voiceModel ?? DEFAULT_VOICE_MODEL;

  // Status lives in a ref (source of truth for async callbacks) AND state
  // (triggers re-renders). `setVoiceStatus` is the ONLY way to update —
  // the raw state setter is deliberately hidden via destructure rename.
  const statusRef = useRef<VoiceStatus>('idle');
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const transcriptionRef = useRef<AbortController | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, _unsafeSetStatus] = useState<VoiceStatus>('idle');
  const setVoiceStatus = useCallback((next: VoiceStatus) => {
    if (!mountedRef.current) return;
    retainActiveInput(statusRef, !['idle', 'error'].includes(next));
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
    let probeGeneration = 0;

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
      // Provider choice is a privacy boundary. A local choice must never start
      // browser/cloud recognition because the local service is unavailable.
      const selected = voiceModelRef.current
        ? (getVoiceProvider(voiceModelRef.current) as VoiceProvider)
        : null;
      if (selected === 'local' || selected === 'groq') {
        if (selected === 'local' && status?.local.managedModel && status.local.managedModel !== voiceModelRef.current) return {
          provider: selected, mode: null,
          reason: 'The installed helper supports Parakeet V3 INT8. Choose that model or disable managed speech to use an external service.',
        };
        if (!status?.[selected]?.available) return {
          provider: selected, mode: null,
          reason: selected === 'local'
            ? 'Local speech is unavailable. Start or repair Parakeet, or explicitly choose another provider in Voice settings.'
            : 'Groq is unavailable. Configure its API key or choose another provider in Voice settings.',
        };
        if (hasMediaRecorder) {
          return { provider: selected, mode: 'media-recorder', reason: null };
        }
        // Server is ready but the browser can't capture audio (insecure origin).
        return {
          provider: selected,
          mode: null,
          reason: isInsecureContext
            ? 'Voice requires HTTPS. Access this site over https:// (e.g. via Tailscale Serve) to enable the mic.'
            : 'This browser does not support audio recording.',
        };
      }

      if (selected === 'web' && hasWebSpeech) {
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
          selected === 'web'
            ? 'This browser does not support browser speech recognition. Choose another provider in Voice settings.'
            : 'Choose an available speech provider in Voice settings.',
      };
    }

    async function probe(fresh = false) {
      const generation = ++probeGeneration;
      let status: ProviderStatus | null = null;
      try {
        const data = await queryClient.fetchQuery({
          queryKey: PROVIDERS_KEY,
          queryFn: () => trpcClient.transcribe.status.query({}),
          // Cached across mounts, and fresh when the providers just changed.
          staleTime: fresh ? 0 : PROVIDERS_FRESH_MS,
        });
        if (cancelled || generation !== probeGeneration) return;
        status = { ...data.providers, web: { available: hasWebSpeech, configured: hasWebSpeech } };
        setProviderStatus(status);
      } catch {
        // Probe failed — fall through with null status; resolve() handles it.
      }
      if (cancelled || generation !== probeGeneration) return;

      const { provider: p, mode, reason } = resolve(status);
      setProvider(p);
      setCaptureMode(mode);
      setUnsupportedReason(reason);
    }

    const onFocus = () => void probe();
    const onProvidersChanged = () => void probe(true);
    void probe();
    window.addEventListener('focus', onFocus);
    window.addEventListener('ri:voice-providers-changed', onProvidersChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('ri:voice-providers-changed', onProvidersChanged);
    };
  }, [voiceModel, queryClient]);

  // ─── Mic lifecycle helpers ──────────────────────────────────
  const stopMic = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  // Helper — reads status without triggering TS control-flow narrowing
  const getStatus = useCallback(() => statusRef.current, []);

  // Detach callbacks before stopping. MediaRecorder dispatches its final data
  // and stop events asynchronously, including after a component unmounts.
  const discardCapture = useCallback(() => {
    generationRef.current += 1;
    transcriptionRef.current?.abort();
    transcriptionRef.current = null;
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.abort();
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  // ─── Server-side transcription: record audio, POST to /api/transcribe ──
  const startServerTranscription = useCallback(async () => {
    // Guard: only start from idle
    if (getStatus() !== 'idle') return;
    const generation = ++generationRef.current;
    const current = () => mountedRef.current && generationRef.current === generation;
    const selectedModel = voiceModelRef.current;
    setVoiceStatus('starting');
    setError(null);

    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      // If cancelled/stopped during getUserMedia, clean up and bail
      if (!current() || getStatus() !== 'starting') {
        mic.getTracks().forEach(t => t.stop());
        return;
      }

      streamRef.current = mic;
      setStream(mic);

      const chunks: Blob[] = [];
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(mic, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (current() && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        if (!current()) return;
        const blob = new Blob(chunks, { type: recorder.mimeType });
        chunks.length = 0;
        mediaRecorderRef.current = null;
        if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;

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
        const transcription = new AbortController();
        transcriptionRef.current = transcription;

        try {
          const form = new FormData();
          const extension = recorder.mimeType.includes('mp4') ? 'm4a' : recorder.mimeType.includes('ogg') ? 'ogg' : 'webm';
          form.append('file', blob, `recording.${extension}`);
          if (selectedModel) {
            form.append('voiceModel', selectedModel);
          }
          const data = await api.upload<{ text?: string; error?: string }>(
            '/transcribe',
            form,
            { signal: transcription.signal },
          );
          if (!current() || transcription.signal.aborted) return;
          if (data.text) {
            setTranscript(prev => prev ? `${prev} ${data.text}` : data.text!);
          } else {
            setError(data.error ?? 'Transcription failed');
          }
        } catch (err) {
          if (current() && !transcription.signal.aborted) setError(`Transcription error: ${err}`);
        } finally {
          if (transcriptionRef.current === transcription) transcriptionRef.current = null;
          if (current()) setVoiceStatus('idle');
        }
      };

      recorder.start(250);
      setVoiceStatus('recording');
    } catch (err) {
      if (!current()) return;
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
      stopTimerRef.current = setTimeout(() => {
        stopTimerRef.current = null;
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }, 500);
    } else {
      stopMic();
      setVoiceStatus('idle');
    }
  }, [stopMic, setVoiceStatus, getStatus]);

  // Cancel both recording and transcription. A late result cannot append to a
  // newer recording or change its lifecycle state.
  // Handles both server-side (MediaRecorder) and Web Speech paths.
  const cancelRecording = useCallback(() => {
    const s = getStatus();
    if (s === 'idle') return;
    discardCapture();
    setStream(null);
    setVoiceStatus('idle');
  }, [discardCapture, setVoiceStatus, getStatus]);

  // ─── Web Speech API fallback ─────────────────────────────

  const startWeb = useCallback(() => {
    if (getStatus() !== 'idle') return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;
    const generation = ++generationRef.current;
    const current = () => mountedRef.current && generationRef.current === generation;

    setError(null);
    if (recognitionRef.current) recognitionRef.current.abort();

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    webTranscriptRef.current = '';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (!current()) return;
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
      if (!current()) return;
      setVoiceStatus('idle');
      recognitionRef.current = null;
    };

    recognition.onerror = (event: Event) => {
      if (!current()) return;
      // abort() fires an 'aborted' error — that's intentional cancel, not a real error
      if ((event as Event & { error?: string }).error === 'aborted') return;
      console.error('[Voice] Web Speech error:', event);
      setError('Speech recognition error');
      setVoiceStatus('idle');
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try { recognition.start(); setVoiceStatus('recording'); }
    catch { recognitionRef.current = null; setError('Could not start browser speech recognition'); setVoiceStatus('idle'); }
  }, [setVoiceStatus, getStatus]);

  const stopWeb = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  // ─── Unified controls ────────────────────────────────────

  const startRecording = useCallback(() => {
    if (!captureMode) return;
    if (provider === 'web') {
      startWeb();
    } else if (provider) {
      // local and groq both use server-side transcription
      startServerTranscription();
    }
  }, [provider, captureMode, startServerTranscription, startWeb]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      stopWeb();
    } else {
      stopServerTranscription();
    }
  }, [stopServerTranscription, stopWeb]);

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
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discardCapture();
      statusRef.current = 'idle';
      retainActiveInput(statusRef, false);
    };
  }, [discardCapture]);

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
