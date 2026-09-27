import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ preferences: { enabled: false, cloudFallback: false }, status: { installed: false, helperAvailable: false }, transcribe: vi.fn() }));
vi.mock('./managed/manager', () => ({ speechPreferences: () => mock.preferences, managedSpeech: () => ({ status: () => mock.status, transcribe: mock.transcribe }) }));
beforeEach(() => { vi.resetModules(); vi.stubEnv('GROQ_API_KEY', 'test-key'); mock.preferences = { enabled: false, cloudFallback: false }; mock.status = { installed: false, helperAvailable: false }; mock.transcribe.mockReset(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline'))); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('requires explicit permission before automatic cloud transcription', async () => {
  const { pickProvider } = await import('./transcribe');
  await expect(pickProvider()).rejects.toThrow('allow automatic Groq fallback');
  mock.preferences.cloudFallback = true;
  await expect(pickProvider()).resolves.toBe('groq/whisper-large-v3-turbo');
});
it('explicitly selected local speech never sends audio to cloud after a failure', async () => {
  mock.preferences = { enabled: true, cloudFallback: true };
  mock.transcribe.mockRejectedValue(new Error('helper unavailable'));
  const { transcribe } = await import('./transcribe');
  await expect(transcribe(new Blob(['audio']), 'local/parakeet-tdt-0.6b-v3')).rejects.toThrow('helper unavailable');
  expect(fetch).not.toHaveBeenCalled();
});
it('explicit Groq selection is itself permission to send the recording', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ text: 'hello' })));
  const { transcribe } = await import('./transcribe');
  await expect(transcribe(new Blob(['audio']), 'groq/whisper-large-v3-turbo')).resolves.toBe('hello');
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
});
it('an installed enabled helper is available without waking the model', async () => {
  mock.preferences.enabled = true; mock.status = { installed: true, helperAvailable: true };
  const { isLocalAvailable } = await import('./transcribe');
  expect(await isLocalAvailable()).toBe(true);
  expect(mock.transcribe).not.toHaveBeenCalled();
});

it('never silently substitutes the managed model for another requested local model', async () => {
  mock.preferences.enabled = true;
  const { transcribe } = await import('./transcribe');
  await expect(transcribe(new Blob(['audio']), 'local/parakeet-tdt-0.6b-v2')).rejects.toThrow('includes Parakeet V3 INT8');
  expect(mock.transcribe).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
