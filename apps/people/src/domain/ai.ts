import { AppError } from '@ri/app-kit/contract';
import type { AppInvocation } from '@ri/app-kit/sdk';
import { z } from 'zod/v4';
import { iso, type Ctx } from './context.js';
import { extractionSetting, type ExtractionSetting } from './coverage.js';
import { touch } from './scope.js';

export const PROMPT_LIMIT = 16000;
export const EXTRACTION_VERSION = 'extract-v1';
export const BRIEFING_VERSION = 'briefing-v1';

/** True only when the owner chose extraction and it is running. Every AI call checks this first. */
export function aiAllowed(ctx: Ctx): boolean {
  const setting = extractionSetting(ctx);
  return setting.enabled && setting.status === 'on';
}

export class AiUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'AiUnavailable'; }
}

/**
 * The only path to Ri's bounded AI capability. With extraction off or paused
 * it throws before any capability call. An unsupported harness or denied
 * access marks extraction unavailable and leaves every manual feature alone.
 */
export async function callAi(ctx: Ctx, invocation: Pick<AppInvocation, 'capability'>, prompt: string): Promise<string> {
  if (!aiAllowed(ctx)) throw new AiUnavailable('Relationship extraction is off');
  if (prompt.length > PROMPT_LIMIT) throw new AppError('invalid_input', 'The extraction prompt exceeds its bound');
  try {
    const result = z.object({ text: z.string().max(20000) }).passthrough().parse(await invocation.capability('ai_text', { prompt }));
    return result.text;
  } catch (error) {
    const code = (error as AppError)?.code;
    if (code === 'unsupported' || code === 'forbidden') {
      markUnavailable(ctx, code === 'forbidden' ? 'Ri has not allowed People to use bounded AI. Allow it in Sources to extract relationship context' : 'Extraction unavailable. The qualified AI harness is not available on this computer');
      throw new AiUnavailable('Extraction unavailable');
    }
    throw error;
  }
}

export function markUnavailable(ctx: Ctx, reason: string) {
  const setting = extractionSetting(ctx);
  const next: ExtractionSetting = { ...setting, status: 'unavailable', reason: reason.slice(0, 300), updatedAt: iso(ctx) };
  ctx.db.tx(() => { ctx.settings.set('extraction', next); touch(ctx); });
}

/** Parse a model reply as strict JSON. Prose around a single JSON object is tolerated, anything else is rejected. */
export function parseModelJson<T>(text: string, schema: z.ZodType<T>): T | null {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Normalize whitespace so an exact quote survives line wrapping. */
export const squash = (value: string) => value.replace(/\s+/g, ' ').trim();
/** The quote must appear in the source text. Returns the exact source substring or null. */
export function exactPassage(source: string, quote: string): string | null {
  const needle = squash(quote);
  if (needle.length < 8) return null;
  const haystack = squash(source);
  const at = haystack.indexOf(needle);
  return at < 0 ? null : haystack.slice(at, at + needle.length);
}
/** A source label inside a prompt: untrusted data, escaped so it cannot close its own block. */
export const fence = (text: string) => text.replace(/<\/?source[^>]*>/gi, '[tag removed]').replace(/<\/?record[^>]*>/gi, '[tag removed]');
