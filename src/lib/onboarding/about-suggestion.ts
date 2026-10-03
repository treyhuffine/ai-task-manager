/**
 * A first draft of "what you're working on", written from the person's own
 * recent agent history (project names and chat titles) for the main chat's
 * first run (docs/main-chat-onboarding.md). A blank "tell me about yourself"
 * box is daunting, and the history usually already says it: they confirm or
 * fix a sentence instead of writing one. One fast, tool-less call through the
 * harness (src/lib/harness/one-shot.ts).
 */

import { z } from 'zod';
import { runHarnessJson } from '@/lib/harness/one-shot';

export interface ProjectSummary {
  name: string;
  /** Recent chat titles in it, newest first. */
  titles: string[];
}

export const ABOUT_MAX = 320;

const schema = z.object({ about: z.string() });

/**
 * What the model sent, fit for a profile field: one paragraph, no long
 * dashes or semicolons (the app's copy rule, and the draft reads as the
 * app's words until the person edits it), cut at a sentence when long.
 */
export function tidyAbout(raw: string): string {
  let text = raw
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/;\s*/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > ABOUT_MAX) {
    const cut = text.slice(0, ABOUT_MAX);
    const end = cut.lastIndexOf('. ');
    text = end > 80 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
  }
  return text;
}

export function aboutPrompt(input: { userName: string | null; projects: ProjectSummary[] }): string {
  const lines = input.projects
    .slice(0, 12)
    .map((p) => `- ${p.name}${p.titles.length ? `: ${p.titles.slice(0, 4).map((t) => t.slice(0, 90)).join(' | ')}` : ''}`);
  return [
    `${input.userName ?? 'Someone'} is setting up a productivity app with an AI assistant that plans their days and runs their coding agents.`,
    'From their recent coding-agent projects and chat titles below, write one or two short sentences in the first person,',
    'as they would describe what they are working on these days (for example "I\'m building X and running Y.").',
    'Be specific and plain. Name the main projects. Leave out one-off chores and anything that reads like a secret.',
    'No long dashes and no semicolons.',
    '',
    'Recent projects, most recent first:',
    ...lines,
  ].join('\n');
}

export async function suggestAbout(input: { userName: string | null; projects: ProjectSummary[] }): Promise<string> {
  if (input.projects.length === 0) return '';
  const result = await runHarnessJson({
    label: 'onboarding-about',
    tier: 'fast',
    timeoutSec: 45,
    prompt: aboutPrompt(input),
    schema,
    shape: '{ "about": "I\'m building ..." }',
  });
  return tidyAbout(result.about);
}
