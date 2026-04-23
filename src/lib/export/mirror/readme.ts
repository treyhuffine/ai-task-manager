/**
 * README.md for the brain directory. Explains to humans and agents what this
 * folder is, how to edit, and what's derived/read-only.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_NAME, APP_SHORT_ID } from '@/constants/app';
import { getBrainDir, BRAIN_PATH_ENV } from '@/lib/config/paths';
import { MIRROR_DISABLED_ENV } from './config';

const README_FILENAME = 'README.md';

function readmeContent(): string {
  return `# ${APP_NAME} Brain

Your ${APP_NAME} data lives in this folder. \`data.db\` is the source of
truth; the markdown files alongside it are a live, always-current mirror
written by the app.

## Live mirror (derived — don't hand-edit)

- \`tasks/\` — one file per task
- \`notes/\` — one file per note
- \`areas/\` — one file per area
- \`stream/\` — one file per captured stream item
- \`attachments/\` — uploaded files (images, PDFs, voice memos) referenced by
  the entities above. Markdown bodies link here via \`../attachments/…\`
- \`.archive/\` — archived or merged-away entities; orphan attachments also
  move to \`.archive/attachments/\` when no entity references them anymore

These files update automatically as you use the app. **Edits here are
overwritten on the next sync.** To make changes, use:

- the ${APP_NAME} app
- the MCP tools exposed by ${APP_NAME}
- direct SQL against the database

## Source of truth

- \`data.db\` — the SQLite database. Everything else in this folder is
  derived from it.

## Why mirror at all?

Your data lives on your disk as plain markdown alongside the database. You can:

- grep it, back it up, commit it to git (gitignore \`data.db*\` and
  \`attachments/\` to keep the repo to portable text)
- open it in Obsidian, VS Code, or any editor
- feed the folder to any LLM for context
- keep reading it even if ${APP_NAME} itself goes away

Portability and observability without giving up the engineering properties of a
real database.

## Filename format

\`{slug}--{uuid}.md\` — the slug is cosmetic, the UUID is the stable identity.
A double-hyphen separator distinguishes slug hyphens from hyphens inside the
UUID. The ID is always the part after the last \`--\`.

## Configuration

- \`${BRAIN_PATH_ENV}\` — point the brain directory somewhere else
- \`${MIRROR_DISABLED_ENV}=1\` — turn the markdown mirror off (db only)

## Force a sync

Run \`${APP_SHORT_ID} export\` to force a full sync (useful after a crash or
if you suspect drift).
`;
}

/** Ensure a README.md exists in the brain dir, writing the default if missing. */
export async function ensureReadme(): Promise<void> {
  const target = path.join(getBrainDir(), README_FILENAME);
  try {
    await fs.access(target);
    // Already exists — leave it alone so user annotations aren't clobbered.
  } catch {
    await fs.mkdir(getBrainDir(), { recursive: true });
    await fs.writeFile(target, readmeContent(), 'utf8');
  }
}
