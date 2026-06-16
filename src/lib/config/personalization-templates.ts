/**
 * User-owned personalization stubs, seeded write-once into the brain dir by
 * `ensureBrainDir()` (next to MEMORY.md). The orchestrator brief references
 * them; the app NEVER regenerates or overwrites them — they're the user's.
 *
 * Two files, deliberately (see the OpenClaw set — we skip IDENTITY/TOOLS as
 * app-owned, and HEARTBEAT as a future proactivity concern):
 *   - USER.md — who the user is + how they want to be worked with.
 *   - SOUL.md — the assistant's voice/persona (incl. what to call it).
 *
 * Small + stable, so the Claude brief `@import`s them (auto-inlined, no read
 * tool call). Pure strings — no agentex import — so this stays safe in the
 * tsx CLI's static graph.
 */

import { APP_NAME } from '@/constants/app';

export const USER_MD_FILENAME = 'USER.md';
export const SOUL_MD_FILENAME = 'SOUL.md';

export function renderUserMdStub(): string {
  return `# About me

This file is yours. ${APP_NAME} reads it but never edits it — tell your
assistant who you are so it doesn't have to re-learn you each session:

- Your name and how you like to be addressed
- What you do / the projects that matter right now
- Working style — deep-work hours, energy patterns, how you like tasks framed
- How to work with you — terse vs. detailed, when to push back, what's off-limits

Delete this guidance and write in your own words. Leave it empty for none.
`;
}

export function renderSoulMdStub(): string {
  return `# Your assistant's voice

This file is yours. ${APP_NAME} reads it but never edits it — shape how your
assistant shows up:

- What it's called (give it a name, if you like)
- Tone and voice — warm, terse, dry, formal…
- Judgment — when to be careful and ask, when to just act
- Anything it should never do

Delete this guidance and write in your own words. Leave it empty for the default.
`;
}
