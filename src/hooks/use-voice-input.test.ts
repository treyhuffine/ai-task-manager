import { hasActiveInput } from '@/lib/client/active-input';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceInput, type UseVoiceInputReturn } from './use-voice-input';

const client = vi.hoisted(() => ({ get: vi.fn(), upload: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: client }));
vi.mock('@/lib/trpc/client', () => ({ trpcClient: { transcribe: { status: { query: client.get } } } }));
vi.mock('@/hooks/use-user-state', () => ({ useUserState: () => ({ data: undefined }) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

class Recorder {
  static all: Recorder[] = [];
  static isTypeSupported = () => true;
  state = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  onstop: (() => void) | null = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  constructor() { Recorder.all.push(this); }
  start() { this.state = 'recording'; }
  requestData() { this.ondataavailable?.({ data: new Blob(['recorded audio']) }); }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => { this.requestData(); this.onstop?.(); });
  }
}

let root: Root | undefined;
/** The app's query cache, fresh for each test so a cached provider probe never carries over. */
let queries: QueryClient;
let voice: UseVoiceInputReturn;
let microphone: ReturnType<typeof vi.fn>;
let track: { stop: ReturnType<typeof vi.fn> };
const local = 'local/parakeet-tdt-0.6b-v3';
const groq = 'groq/whisper-large-v3-turbo';

function Harness({ model = local }: { model?: string }) {
  const value = useVoiceInput(model);
  useLayoutEffect(() => { voice = value; });
  return null;
}

async function mount(model = local) {
  root ??= createRoot(document.createElement('div'));
  await act(async () => { root!.render(createElement(QueryClientProvider, { client: queries }, createElement(Harness, { model }))); });
}
async function start() { await act(async () => { voice.startRecording(); }); }
async function finish() {
  await act(async () => { voice.stopRecording(); await vi.advanceTimersByTimeAsync(500); });
}

beforeEach(() => {
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.useFakeTimers();
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('MediaRecorder', Recorder);
  Object.assign(window, { MediaRecorder: Recorder, isSecureContext: true, SpeechRecognition: vi.fn() });
  track = { stop: vi.fn() };
  microphone = vi.fn().mockResolvedValue({ getTracks: () => [track] });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: microphone } });
  Recorder.all = [];
  client.get.mockReset().mockResolvedValue({ providers: {
    local: { available: true, configured: true }, groq: { available: true, configured: true }, web: { available: true, configured: true },
  } });
  client.upload.mockReset().mockResolvedValue({ text: 'recognized words' });
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('voice privacy and asynchronous lifecycle', () => {
  it('does not fall back to Groq or browser recognition when selected local is unavailable', async () => {
    client.get.mockResolvedValue({ providers: {
      local: { available: false, configured: true }, groq: { available: true, configured: true }, web: { available: true, configured: true },
    } });
    await mount();
    expect(voice.captureMode).toBeNull();
    expect(voice.provider).toBe('local');
    await start();
    expect(microphone).not.toHaveBeenCalled();
    expect(window.SpeechRecognition).not.toHaveBeenCalled();
  });

  it('captures the selected provider when recording starts', async () => {
    await mount();
    await start();
    await mount(groq);
    await finish();
    expect((client.upload.mock.calls[0][1] as FormData).get('voiceModel')).toBe(local);
    expect(voice.transcript).toBe('recognized words');
    expect(hasActiveInput()).toBe(false);
  });

  it('does not record an unsupported local model through the managed v3 helper', async () => {
    client.get.mockResolvedValue({ providers: {
      local: { available: true, configured: true, managedModel: local }, groq: { available: true, configured: true }, web: { available: true, configured: true },
    } });
    await mount('local/parakeet-tdt-0.6b-v2');
    expect(voice.captureMode).toBeNull();
    expect(voice.unsupportedReason).toContain('V3 INT8');
    await start();
    expect(microphone).not.toHaveBeenCalled();
  });

  it('cancels an upload and ignores its late result while another recording runs', async () => {
    const result = deferred<{ text: string }>();
    client.upload.mockReturnValueOnce(result.promise);
    await mount(); await start(); await finish();
    expect(voice.isTranscribing).toBe(true);
    const signal = client.upload.mock.calls[0][2].signal as AbortSignal;
    await act(async () => { voice.cancelRecording(); });
    expect(signal.aborted).toBe(true);
    expect(voice.isTranscribing).toBe(false);
    await start();
    await act(async () => { result.resolve({ text: 'canceled transcript' }); });
    expect(voice.transcript).toBe('');
    expect(voice.isRecording).toBe(true);
    expect(hasActiveInput()).toBe(true);
  });

  it('does not upload when canceled during the recorder stop delay', async () => {
    await mount(); await start();
    await act(async () => { voice.stopRecording(); voice.cancelRecording(); await vi.advanceTimersByTimeAsync(500); });
    expect(client.upload).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(hasActiveInput()).toBe(false);
  });

  it('stops recording on unmount without uploading its final data event', async () => {
    await mount(); await start();
    expect(hasActiveInput()).toBe(true);
    await act(async () => { root!.unmount(); root = undefined; });
    expect(client.upload).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(Recorder.all[0].state).toBe('inactive');
    expect(hasActiveInput()).toBe(false);
  });

  it('aborts transcription on unmount', async () => {
    const result = deferred<{ text: string }>();
    client.upload.mockReturnValueOnce(result.promise);
    await mount(); await start(); await finish();
    const signal = client.upload.mock.calls[0][2].signal as AbortSignal;
    await act(async () => { root!.unmount(); root = undefined; });
    expect(signal.aborted).toBe(true);
    await act(async () => { result.resolve({ text: 'late transcript' }); });
    expect(hasActiveInput()).toBe(false);
  });

  it('discards late microphone permission results after cancellation', async () => {
    const pending = deferred<{ getTracks: () => { stop: ReturnType<typeof vi.fn> }[] }>();
    microphone.mockReturnValueOnce(pending.promise);
    await mount(); await start();
    await act(async () => { voice.cancelRecording(); });
    await act(async () => { pending.resolve({ getTracks: () => [track] }); });
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(Recorder.all).toHaveLength(0);
    expect(voice.isRecording).toBe(false);
  });

  it('refreshes availability after managed speech changes without reloading', async () => {
    const providers = {
      local: { available: false, configured: true }, groq: { available: true, configured: true }, web: { available: false, configured: false },
    };
    client.get.mockResolvedValueOnce({ providers });
    await mount();
    expect(voice.captureMode).toBeNull();
    expect(voice.providerStatus?.web.available).toBe(true);
    await act(async () => { window.dispatchEvent(new window.Event('ri:voice-providers-changed')); });
    expect(voice.captureMode).toBe('media-recorder');
  });
});
