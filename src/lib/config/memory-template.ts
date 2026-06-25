/**
 * Initial MEMORY.md placed in the brain directory on first init.
 *
 * Brain-level memory the orchestrator reads on every session.
 * Written once by `ensureBrainDir()` if absent; never overwritten so
 * user edits survive.
 *
 * Includes a Decisions section the agent appends to via
 * `create_note { title: "Decision: ..." }`. The note title prefix is
 * the only convention — no schema change — and the notes list has a
 * `Decisions` filter chip that surfaces these without a separate
 * surface.
 */

import { APP_NAME } from '@/constants/app';

export function renderBrainMemoryMd(): string {
  return `# ${APP_NAME} brain memory

Long-running scratchpad for the agent. Add facts you want available in
every future session: user role + working style, recurring projects,
naming conventions, "do not touch" lists, anything you'd otherwise
have to re-state at the top of each conversation.

## Decisions

When you make a decision of substance during a run, write a note via
\`create_note\` with a title that starts with \`Decision: \`, for example
\`Decision: switch transcript storage to JSON Lines\`. The body should
capture:

- **Context**: what surfaced the decision
- **Options**: what was considered
- **Decision**: what was chosen, and why
- **Consequences**: what changes downstream

Decisions stay queryable in the notes list (filter chip:
\`Decisions\`). Six months later, "Why did we decide X?" maps to one
search, not an archeology project.
`;
}
