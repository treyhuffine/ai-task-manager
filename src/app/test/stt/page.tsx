"use client"

import { useState, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { LiveWaveform } from "@/components/ui/live-waveform"
import { Mic, Square, RotateCcw, Loader2, Play } from "lucide-react"

// ─── Models from sidecar MODEL_CONFIGS ──────────────────────
// Order: INT8 models first (already loaded, lightweight), then heavier precision variants
const BENCH_MODELS = [
  {
    id: "parakeet-tdt-0.6b-v3",
    label: "V3 INT8",
    description: "Quantized — fastest inference, multilingual",
    version: "v3" as const,
  },
  {
    id: "parakeet-tdt-0.6b-v2",
    label: "V2 INT8",
    description: "Quantized — fastest inference, English-only",
    version: "v2" as const,
  },
  {
    id: "grikdotnet/parakeet-tdt-0.6b-fp16",
    label: "V3 FP16",
    description: "Half precision — balanced speed/accuracy, multilingual",
    version: "v3" as const,
  },
  {
    id: "istupakov/parakeet-tdt-0.6b-v3-onnx",
    label: "V3 FP32",
    description: "Full precision — max accuracy, multilingual",
    version: "v3" as const,
  },
  {
    id: "parakeet-tdt-0.6b-v2-fp32",
    label: "V2 FP32",
    description: "Full precision — max accuracy, English-only",
    version: "v2" as const,
  },
] as const

type ModelResult = {
  status: "idle" | "transcribing" | "done" | "error"
  text?: string
  latencyMs?: number
  error?: string
}

// ─── Page ───────────────────────────────────────────────────

export default function SttBenchPage() {
  const [isRecording, setIsRecording] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [results, setResults] = useState<Record<string, ModelResult>>({})
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const startRecording = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      setStream(mediaStream)

      const recorder = new MediaRecorder(mediaStream, {
        mimeType: "audio/webm;codecs=opus",
      })
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" })
        setAudioBlob(blob)
        setAudioUrl(URL.createObjectURL(blob))
        mediaStream.getTracks().forEach((t) => t.stop())
        setStream(null)
      }

      mediaRecorderRef.current = recorder
      recorder.start(250)
      setIsRecording(true)
      setResults({})
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
        setAudioUrl(null)
      }
      setAudioBlob(null)
    } catch (err) {
      console.error("Failed to start recording:", err)
    }
  }, [audioUrl])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
  }, [])

  const runBenchmark = useCallback(async (blob: Blob) => {
    setIsRunning(true)

    // Run sequentially for accurate per-model timing (sidecar is CPU-bound)
    for (const model of BENCH_MODELS) {
      setResults((prev) => ({
        ...prev,
        [model.id]: { status: "transcribing" },
      }))

      try {
        const form = new FormData()
        form.append("file", blob, "recording.webm")
        form.append("model", model.id)

        const res = await fetch("/api/stt-bench", {
          method: "POST",
          body: form,
        })
        const data = await res.json()

        if (!res.ok) {
          setResults((prev) => ({
            ...prev,
            [model.id]: { status: "error", error: data.error },
          }))
        } else {
          setResults((prev) => ({
            ...prev,
            [model.id]: {
              status: "done",
              text: data.text,
              latencyMs: data.latencyMs,
            },
          }))
        }
      } catch (err) {
        setResults((prev) => ({
          ...prev,
          [model.id]: { status: "error", error: String(err) },
        }))
      }
    }

    setIsRunning(false)
  }, [])

  const reset = useCallback(() => {
    setResults({})
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(null)
    setAudioBlob(null)
    setIsRunning(false)
  }, [audioUrl])

  const fastestDone = Object.values(results)
    .filter((r) => r.status === "done" && r.latencyMs != null)
    .reduce<number | null>(
      (min, r) => (min === null || r.latencyMs! < min ? r.latencyMs! : min),
      null,
    )

  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">
            Parakeet STT Bench
          </h1>
          <p className="text-muted-foreground mt-1">
            Record audio and compare transcription across all local Parakeet
            models
          </p>
        </div>

        {/* Recording controls */}
        <Card className="mb-8">
          <CardContent className="flex flex-col items-center gap-4 py-8">
            <div className="w-full max-w-md">
              <LiveWaveform
                active={isRecording}
                stream={stream}
                mode="static"
                height={64}
                barColor="var(--primary)"
              />
            </div>

            <div className="flex items-center gap-3">
              {!isRecording && !audioBlob && (
                <Button onClick={startRecording} size="lg" disabled={isRunning}>
                  <Mic className="size-4" data-icon="inline-start" />
                  Record
                </Button>
              )}

              {isRecording && (
                <Button
                  onClick={stopRecording}
                  variant="destructive"
                  size="lg"
                >
                  <Square className="size-3.5" data-icon="inline-start" />
                  Stop
                </Button>
              )}

              {audioBlob && !isRecording && (
                <>
                  <Button
                    onClick={() => runBenchmark(audioBlob)}
                    size="lg"
                    disabled={isRunning}
                  >
                    {isRunning ? (
                      <Loader2
                        className="size-4 animate-spin"
                        data-icon="inline-start"
                      />
                    ) : (
                      <Play className="size-4" data-icon="inline-start" />
                    )}
                    {isRunning ? "Running..." : "Run Benchmark"}
                  </Button>
                  <Button
                    onClick={startRecording}
                    variant="outline"
                    size="lg"
                    disabled={isRunning}
                  >
                    <Mic className="size-4" data-icon="inline-start" />
                    Re-record
                  </Button>
                  <Button
                    onClick={reset}
                    variant="ghost"
                    size="lg"
                    disabled={isRunning}
                  >
                    <RotateCcw className="size-4" data-icon="inline-start" />
                    Reset
                  </Button>
                </>
              )}
            </div>

            {isRecording && (
              <p className="text-muted-foreground animate-pulse text-sm">
                Recording...
              </p>
            )}

            {audioUrl && !isRecording && (
              <audio controls src={audioUrl} className="mt-2 h-8 w-full max-w-md" />
            )}
          </CardContent>
        </Card>

        {/* Results */}
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h2 className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wider">
              V3 — Multilingual (25 languages)
            </h2>
            <div className="flex flex-col gap-3">
              {BENCH_MODELS.filter((m) => m.version === "v3").map((model) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  result={results[model.id]}
                  isFastest={
                    fastestDone !== null &&
                    results[model.id]?.latencyMs === fastestDone
                  }
                />
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wider">
              V2 — English optimized
            </h2>
            <div className="flex flex-col gap-3">
              {BENCH_MODELS.filter((m) => m.version === "v2").map((model) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  result={results[model.id]}
                  isFastest={
                    fastestDone !== null &&
                    results[model.id]?.latencyMs === fastestDone
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Model result card ──────────────────────────────────────

function ModelCard({
  model,
  result,
  isFastest,
}: {
  model: (typeof BENCH_MODELS)[number]
  result?: ModelResult
  isFastest?: boolean
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm">{model.label}</CardTitle>
            <CardDescription className="truncate">
              {model.description}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {result?.latencyMs != null && (
              <Badge
                variant="outline"
                className={
                  isFastest
                    ? "border-emerald-500/30 bg-emerald-500/10 font-mono text-xs text-emerald-600 dark:text-emerald-400"
                    : "font-mono text-xs"
                }
              >
                {(result.latencyMs / 1000).toFixed(2)}s
              </Badge>
            )}
            <StatusIndicator status={result?.status} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {result?.status === "transcribing" && (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-3 animate-spin" />
            Transcribing...
          </div>
        )}
        {result?.status === "done" && (
          <p className="text-sm leading-relaxed">
            {result.text || <span className="text-muted-foreground italic">(empty)</span>}
          </p>
        )}
        {result?.status === "error" && (
          <p className="text-destructive text-sm">{result.error}</p>
        )}
        {(!result || result.status === "idle") && (
          <p className="text-muted-foreground/50 text-sm italic">
            Waiting for audio...
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function StatusIndicator({ status }: { status?: string }) {
  if (!status || status === "idle") return null
  if (status === "transcribing")
    return (
      <span className="bg-primary/20 size-2 animate-pulse rounded-full" />
    )
  if (status === "done")
    return <span className="size-2 rounded-full bg-emerald-500" />
  if (status === "error")
    return <span className="size-2 rounded-full bg-red-500" />
  return null
}
