/**
 * Small natural-language → cron compiler.
 *
 * Heuristic only — covers the patterns users actually type into the
 * schedule creation form. When the heuristic fails, the form falls
 * back to manual cron entry; we don't ship an LLM call for this.
 *
 * Supported shapes:
 *   - "every weekday at 9am"     -> "0 9 * * 1-5"
 *   - "every day at 9am"         -> "0 9 * * *"
 *   - "daily at 3pm"             -> "0 15 * * *"
 *   - "every Monday at 10:30"    -> "30 10 * * 1"
 *   - "every 30 minutes"         -> "(STAR)/30 * * * *"
 *   - "hourly" / "every hour"    -> "0 * * * *"
 *   - "every 2 hours"            -> "0 (STAR)/2 * * *"
 *   - "every Tuesday and Thursday at 4pm" -> "0 16 * * 2,4"
 *
 * Returns `{ ok: true, expression, previewUtc }` on success or
 * `{ ok: false, error }` when the heuristic doesn't recognize the input.
 */

import { validateCronExpression } from './cron';

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

export interface CompileResult {
  ok: true;
  expression: string;
  previewUtc?: string[];
}

export interface CompileError {
  ok: false;
  error: string;
}

export function naturalLanguageToCron(input: string, timezone = 'UTC'): CompileResult | CompileError {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return { ok: false, error: 'Enter a schedule like "every weekday at 9am"' };

  const expression = compileExpression(text);
  if (!expression) {
    return {
      ok: false,
      error: 'Could not parse. Try "every weekday at 9am" or enter cron directly.',
    };
  }

  // Validate via croner so the preview matches the runner.
  const v = validateCronExpression(expression, timezone);
  if (!v.valid) return { ok: false, error: v.error ?? 'Invalid cron expression' };
  return { ok: true, expression, previewUtc: v.preview };
}

function compileExpression(text: string): string | null {
  // Catch the simple periodic shapes first.
  if (text === 'hourly' || text === 'every hour') return '0 * * * *';
  if (text === 'daily' || text === 'every day') return '0 9 * * *';
  if (text === 'weekly') return '0 9 * * 1';

  const everyN = text.match(/^every (\d+) (minutes?|hours?)$/);
  if (everyN) {
    const n = parseInt(everyN[1], 10);
    if (everyN[2].startsWith('minute')) return `*/${n} * * * *`;
    return `0 */${n} * * *`;
  }

  // Extract the time first (h, h:mm, hpm, h:mm am).
  const time = extractTime(text);
  // Determine the day-of-week set.
  const dow = extractDow(text);

  if (time && dow != null) {
    return `${time.minute} ${time.hour} * * ${dow}`;
  }

  return null;
}

interface ParsedTime {
  hour: number;
  minute: number;
}

function extractTime(text: string): ParsedTime | null {
  // 9am, 9 am, 3pm, 12:30pm, 09:00
  const ampm = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (ampm) {
    let hour = parseInt(ampm[1], 10);
    const minute = ampm[2] ? parseInt(ampm[2], 10) : 0;
    if (ampm[3] === 'pm' && hour !== 12) hour += 12;
    if (ampm[3] === 'am' && hour === 12) hour = 0;
    return { hour, minute };
  }
  const military = text.match(/(\d{1,2}):(\d{2})/);
  if (military) {
    return { hour: parseInt(military[1], 10), minute: parseInt(military[2], 10) };
  }
  const noonMidnight = text.match(/\b(noon|midnight)\b/);
  if (noonMidnight) {
    return { hour: noonMidnight[1] === 'noon' ? 12 : 0, minute: 0 };
  }
  return null;
}

function extractDow(text: string): string | null {
  // "weekday" → 1-5, "weekend" → 0,6
  if (/\bweekday(s)?\b/.test(text)) return '1-5';
  if (/\bweekend(s)?\b/.test(text)) return '0,6';
  if (/\bevery day\b|\bdaily\b/.test(text)) return '*';
  // Match listed day names, e.g. "monday", "tuesday and thursday"
  const days = new Set<number>();
  for (const [name, dow] of Object.entries(DAY_NAMES)) {
    const re = new RegExp(`\\b${name}s?\\b`, 'i');
    if (re.test(text)) days.add(dow);
  }
  if (days.size === 0) {
    if (/\bevery\b/.test(text) && text.includes(' at ')) return '*';
    return null;
  }
  return Array.from(days).sort((a, b) => a - b).join(',');
}
