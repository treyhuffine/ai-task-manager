// ─── Voice model catalog ──────────────────────────────────────
// Format: "provider/model-name"
//   provider determines routing (which API endpoint + env var)
//   model-name is passed through to the provider's API

export interface VoiceModel {
  id: string
  label: string
  description: string
  language: 'english' | 'multilingual'
  provider: 'local' | 'groq' | 'openai' | 'web'
  /** Env var that must be set for this provider to work */
  envKey: string | null
  speed: number   // 1-10 relative
  accuracy: number // 1-10 relative
}

/** Extract the provider prefix from a voice model ID */
export function getVoiceProvider(modelId: string): string {
  return modelId.split('/')[0]
}

/** Extract the model name (everything after the first slash) */
export function getVoiceModelName(modelId: string): string {
  return modelId.slice(modelId.indexOf('/') + 1)
}

export const VOICE_MODELS: VoiceModel[] = [
  // ─── Local (self-hosted via LOCAL_SPEECH_TO_TEXT_URL) ──────
  {
    id: 'local/parakeet-tdt-0.6b-v3',
    label: 'Parakeet V3',
    description: 'NVIDIA multilingual model: 25 languages, auto-detect',
    language: 'multilingual',
    provider: 'local',
    envKey: 'LOCAL_SPEECH_TO_TEXT_URL',
    speed: 9,
    accuracy: 9,
  },
  {
    id: 'local/parakeet-tdt-0.6b-v2',
    label: 'Parakeet V2',
    description: 'NVIDIA English-optimized: slightly better English WER than V3',
    language: 'english',
    provider: 'local',
    envKey: 'LOCAL_SPEECH_TO_TEXT_URL',
    speed: 10,
    accuracy: 9.5,
  },
  {
    id: 'local/parakeet-tdt-0.6b-v3-fp32',
    label: 'Parakeet V3 (FP32)',
    description: 'Full precision V3: same accuracy, slower inference',
    language: 'multilingual',
    provider: 'local',
    envKey: 'LOCAL_SPEECH_TO_TEXT_URL',
    speed: 7,
    accuracy: 9,
  },
  {
    id: 'local/parakeet-tdt-0.6b-v2-fp32',
    label: 'Parakeet V2 (FP32)',
    description: 'Full precision V2 English: same accuracy, slower inference',
    language: 'english',
    provider: 'local',
    envKey: 'LOCAL_SPEECH_TO_TEXT_URL',
    speed: 7,
    accuracy: 9.5,
  },

  // ─── Groq cloud ────────────────────────────────────────────
  {
    id: 'groq/whisper-large-v3-turbo',
    label: 'Whisper Large V3 Turbo (Groq)',
    description: 'Fast cloud transcription via Groq: multilingual',
    language: 'multilingual',
    provider: 'groq',
    envKey: 'GROQ_API_KEY',
    speed: 9,
    accuracy: 9,
  },
  {
    id: 'groq/whisper-large-v3',
    label: 'Whisper Large V3 (Groq)',
    description: 'High-accuracy cloud transcription via Groq: multilingual',
    language: 'multilingual',
    provider: 'groq',
    envKey: 'GROQ_API_KEY',
    speed: 7,
    accuracy: 9.5,
  },
  {
    id: 'groq/distil-whisper-large-v3-en',
    label: 'Distil Whisper (Groq)',
    description: 'Fastest Groq option: English only',
    language: 'english',
    provider: 'groq',
    envKey: 'GROQ_API_KEY',
    speed: 10,
    accuracy: 8.5,
  },

  // ─── OpenAI cloud ──────────────────────────────────────────
  {
    id: 'openai/gpt-4o-mini-transcribe',
    label: 'GPT-4o Mini Transcribe (OpenAI)',
    description: 'OpenAI recommended: 35% lower WER than Whisper, half the cost',
    language: 'multilingual',
    provider: 'openai',
    envKey: 'OPENAI_API_KEY',
    speed: 8,
    accuracy: 9.5,
  },
  {
    id: 'openai/gpt-4o-transcribe',
    label: 'GPT-4o Transcribe (OpenAI)',
    description: 'Highest accuracy OpenAI model: multilingual',
    language: 'multilingual',
    provider: 'openai',
    envKey: 'OPENAI_API_KEY',
    speed: 7,
    accuracy: 10,
  },
  {
    id: 'openai/whisper-1',
    label: 'Whisper (OpenAI)',
    description: 'Legacy OpenAI Whisper: supports word-level timestamps',
    language: 'multilingual',
    provider: 'openai',
    envKey: 'OPENAI_API_KEY',
    speed: 7,
    accuracy: 8.5,
  },

  // ─── Browser fallback ─────────────────────────────────────
  {
    id: 'web/speech-recognition',
    label: 'Browser Speech API',
    description: 'Built-in browser speech recognition: no setup required',
    language: 'multilingual',
    provider: 'web',
    envKey: null,
    speed: 8,
    accuracy: 6,
  },
]

export const VOICE_MODEL_MAP = new Map(VOICE_MODELS.map(m => [m.id, m]))

export const DEFAULT_VOICE_MODEL = 'local/parakeet-tdt-0.6b-v3'
