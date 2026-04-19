/**
 * README.md for the mirror root. Explains to humans and agents what this
 * folder is, how to edit, and what's read-only.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_NAME, APP_SHORT_ID } from '@/constants/app';
import { getMirrorRoot } from './config';

const README_FILENAME = 'README.md';

function readmeContent(): string {
  return `# ${APP_NAME} Data

Your ${APP_NAME} data lives in this folder. Part of it is a live markdown
mirror of the database; part of it is internal state used by the app itself.

## What's a live mirror (read from these)

- \`tasks/\` — one file per task
- \`notes/\` — one file per note
- \`areas/\` — one file per area
- \`stream/\` — one file per captured stream item
- \`.archive/\` — archived or merged-away entities

These files update automatically as you use the app. **Edits here are
overwritten on the next sync.** To make changes, use:

- the ${APP_NAME} app
- the MCP tools exposed by ${APP_NAME}
- direct SQL against the database

## What's internal (leave alone)

- \`data.db\` — the SQLite database, source of truth
- \`config.json\` — local auth + settings
- \`captures/\` — raw audio files from voice capture
- \`snapshots/\` — one-shot snapshots from \`${APP_SHORT_ID} snapshot\`

## Why mirror at all?

Your data lives on your disk as plain markdown. You can:

- grep it, back it up, commit it to git
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

- \`${APP_SHORT_ID.toUpperCase()}_MIRROR_PATH\` — point the mirror somewhere else
- \`${APP_SHORT_ID.toUpperCase()}_MIRROR_DISABLED=1\` — turn mirroring off

## Force a sync

Run \`${APP_SHORT_ID} export\` to force a full sync (useful after a crash or
if you suspect drift).
`;
}

/** Ensure a README.md exists in the mirror root, writing the default if missing. */
export async function ensureReadme(): Promise<void> {
  const target = path.join(getMirrorRoot(), README_FILENAME);
  try {
    await fs.access(target);
    // Already exists — leave it alone so user annotations aren't clobbered.
  } catch {
    await fs.mkdir(getMirrorRoot(), { recursive: true });
    await fs.writeFile(target, readmeContent(), 'utf8');
  }
}
