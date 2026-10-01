/**
 * Areas to suggest in the main chat's first run (docs/main-chat-onboarding.md),
 * from what the person said they're working on and the projects they brought
 * in. One fast, tool-less call through the user's harness
 * (src/lib/harness/one-shot.ts). The UI always has plain presets to fall back
 * on, so a slow or failed call costs nothing but the suggestions.
 */

import { z } from 'zod';
import { runHarnessJson } from '@/lib/harness/one-shot';

export interface AreaSuggestion {
  name: string;
  emoji: string;
}

/** A few areas, not a taxonomy. */
export const MAX_AREA_SUGGESTIONS = 4;

const NAME_MAX = 32;

/**
 * Sparkle, star-cluster and magic-wand marks aren't used anywhere in the app
 * (AGENTS.md, icons describe their purpose), emoji included. A suggestion
 * that reaches for one gets the folder.
 */
const BANNED_EMOJI = /[\u2728\u2B50\u{1F31F}\u{1F4AB}\u{1FA84}\u{1F320}\u{1F386}\u{1F387}]/u;

const schema = z.object({
  areas: z
    .array(z.object({ name: z.string(), emoji: z.string() }))
    .max(8),
});

const SHAPE = '{ "areas": [ { "name": "Work", "emoji": "💼" } ] }';

/** Clean what the model sent: trimmed, short, one emoji, no repeats, at most four. */
export function tidyAreaSuggestions(raw: { name: string; emoji: string }[]): AreaSuggestion[] {
  const seen = new Set<string>();
  const out: AreaSuggestion[] = [];
  for (const item of raw) {
    const name = item.name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const emoji = item.emoji.trim().slice(0, 8);
    const usable = /\p{Extended_Pictographic}/u.test(Array.from(emoji)[0] ?? '') && !BANNED_EMOJI.test(emoji);
    out.push({ name, emoji: usable ? emoji : '📁' });
    if (out.length === MAX_AREA_SUGGESTIONS) break;
  }
  return out;
}

export function areaSuggestionPrompt(input: { about: string; projects: string[] }): string {
  const projects = input.projects.length ? `\nProjects they brought in: ${input.projects.slice(0, 20).join(', ')}.` : '';
  return [
    'Someone is setting up a productivity app that sorts their tasks, notes and AI agents into areas:',
    'broad parts of life or work (for example Work, Personal, Health, a company or a side project).',
    'Suggest two to four areas for them. Use short names they would say themselves, and one fitting emoji each',
    '(never a sparkle, star or magic wand).',
    'Prefer their own words and project names over generic ones, and include Personal if nothing covers life outside work.',
    '',
    `What they said they're working on: ${input.about.trim()}${projects}`,
  ].join('\n');
}

export async function suggestAreas(input: { about: string; projects: string[] }): Promise<AreaSuggestion[]> {
  const result = await runHarnessJson({
    label: 'onboarding-areas',
    tier: 'fast',
    timeoutSec: 45,
    prompt: areaSuggestionPrompt(input),
    schema,
    shape: SHAPE,
  });
  return tidyAreaSuggestions(result.areas);
}
