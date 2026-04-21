'use client'

import { useState } from 'react'
import { ChevronRight, Wrench, Search, Pencil, Circle, CheckCircle2, Trash2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { McpEntity, McpInnerStep, McpResponsePayload } from '@/lib/mcp/types'

interface McpToolDisplayProps {
  /** "query" | "update" — the outer MCP tool that was invoked */
  toolName: string
  /** Raw input the outer LLM sent — typically { message: string } */
  input: unknown
  /** Tool state from AI SDK: 'input-streaming' | 'input-available' | 'output-available' | 'output-error' */
  state: string
  /** Raw text output from the MCP call — JSON-encoded McpResponsePayload */
  output?: string
  /** Error text if state is 'output-error' */
  errorText?: string
}

export function McpToolDisplay({ toolName, input, state, output, errorText }: McpToolDisplayProps) {
  const [open, setOpen] = useState(false)

  const inputMessage = extractMessage(input)
  const inputContext = extractContext(input)
  const parsed = parsePayload(output)
  const running = state === 'input-streaming' || state === 'input-available'
  const errored = state === 'output-error'

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 my-1.5 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/50 transition-colors"
      >
        <ChevronRight size={12} className={cn('text-muted-foreground transition-transform', open && 'rotate-90')} />
        {toolName === 'query' ? <Search size={12} className="text-blue-500" /> : <Pencil size={12} className="text-amber-500" />}
        <span className="font-medium text-foreground">{toolName}</span>
        <span className="text-muted-foreground truncate flex-1">{inputMessage || '…'}</span>
        <StatusPill state={state} />
      </button>

      {open && (
        <div className="border-t border-border/60 px-2 py-2 space-y-2">
          {/* Message */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Message</div>
            <div className="rounded bg-background/60 border border-border/60 p-1.5 font-mono text-[11px] break-words whitespace-pre-wrap">
              {inputMessage || JSON.stringify(input, null, 2)}
            </div>
          </div>

          {/* Context (optional) */}
          {inputContext && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Context</div>
              <div className="rounded bg-background/60 border border-border/60 p-1.5 font-mono text-[11px] break-words whitespace-pre-wrap text-muted-foreground">
                {inputContext}
              </div>
            </div>
          )}

          {/* Running state */}
          {running && (
            <div className="text-[11px] text-muted-foreground italic">Running on the server…</div>
          )}

          {/* Error */}
          {errored && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-destructive mb-0.5">Error</div>
              <div className="rounded bg-destructive/10 border border-destructive/30 p-1.5 font-mono text-[11px] text-destructive break-words whitespace-pre-wrap">
                {errorText || 'Tool call failed.'}
              </div>
            </div>
          )}

          {/* Response payload */}
          {parsed && (
            <>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Response</div>
                <div className="rounded bg-background/60 border border-border/60 p-1.5 text-[11px] break-words whitespace-pre-wrap">
                  {parsed.response}
                </div>
              </div>

              {parsed.entities.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                    Entities ({parsed.entities.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {parsed.entities.map((e, i) => <EntityPill key={i} entity={e} />)}
                  </div>
                </div>
              )}

              {parsed.innerSteps && parsed.innerSteps.length > 0 && (
                <InnerStepsList steps={parsed.innerSteps} />
              )}
            </>
          )}

          {/* Raw output fallback when we couldn't parse */}
          {output && !parsed && !errored && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Raw output</div>
              <pre className="rounded bg-background/60 border border-border/60 p-1.5 font-mono text-[11px] break-words whitespace-pre-wrap overflow-x-auto">
                {output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatusPill({ state }: { state: string }) {
  const label = state === 'input-streaming' ? 'streaming'
    : state === 'input-available' ? 'running'
    : state === 'output-available' ? 'done'
    : state === 'output-error' ? 'error'
    : state

  const color = state === 'output-error' ? 'text-destructive bg-destructive/10'
    : state === 'output-available' ? 'text-green-600 bg-green-500/10'
    : 'text-muted-foreground bg-muted'

  return (
    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-mono', color)}>
      {label}
    </span>
  )
}

function EntityPill({ entity }: { entity: McpEntity }) {
  const icon = entity.action === 'created' ? <Plus size={10} />
    : entity.action === 'completed' ? <CheckCircle2 size={10} />
    : entity.action === 'deleted' ? <Trash2 size={10} />
    : entity.action === 'updated' ? <Pencil size={10} />
    : <Circle size={10} />

  return (
    <span className="inline-flex items-center gap-1 rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px] font-mono">
      {icon}
      <span className="text-muted-foreground">{entity.type}</span>
      <span className="text-foreground">{entity.title ?? entity.id.slice(0, 8)}</span>
      <span className="text-muted-foreground/60">· {entity.action}</span>
    </span>
  )
}

function InnerStepsList({ steps }: { steps: McpInnerStep[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors mb-0.5"
      >
        <ChevronRight size={10} className={cn('transition-transform', open && 'rotate-90')} />
        <Wrench size={10} />
        Inner server tool calls ({steps.length})
      </button>
      {open && (
        <div className="pl-3 space-y-1 border-l border-border/60">
          {steps.map((step, i) => <InnerStepRow key={i} step={step} index={i} />)}
        </div>
      )}
    </div>
  )
}

function InnerStepRow({ step, index }: { step: McpInnerStep; index: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded border border-border/40 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-1.5 py-1 text-left hover:bg-muted/40 transition-colors"
      >
        <ChevronRight size={10} className={cn('text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="text-[10px] font-mono text-muted-foreground">#{index + 1}</span>
        <span className="text-[11px] font-medium font-mono">{step.toolName}</span>
      </button>
      {open && (
        <div className="px-2 pb-1.5 pt-0.5 space-y-1">
          <div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Input</div>
            <pre className="font-mono text-[10px] break-words whitespace-pre-wrap overflow-x-auto">
              {JSON.stringify(step.input, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Output</div>
            <pre className="font-mono text-[10px] break-words whitespace-pre-wrap overflow-x-auto">
              {JSON.stringify(step.output, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

function extractMessage(input: unknown): string | undefined {
  if (typeof input === 'object' && input !== null && 'message' in input) {
    const msg = (input as { message?: unknown }).message
    return typeof msg === 'string' ? msg : undefined
  }
  return undefined
}

function extractContext(input: unknown): string | undefined {
  if (typeof input === 'object' && input !== null && 'context' in input) {
    const ctx = (input as { context?: unknown }).context
    return typeof ctx === 'string' && ctx.trim().length > 0 ? ctx : undefined
  }
  return undefined
}

function parsePayload(output: string | undefined): McpResponsePayload | null {
  if (!output) return null
  try {
    const parsed = JSON.parse(output) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'response' in parsed &&
      'entities' in parsed
    ) {
      return parsed as McpResponsePayload
    }
    return null
  } catch {
    return null
  }
}
