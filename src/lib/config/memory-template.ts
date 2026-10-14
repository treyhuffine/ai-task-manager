/**
 * Initial MEMORY.md placed in the brain directory on first init.
 *
 * Brain-level memory the orchestrator reads on every session.
 * Written once by `ensureBrainDir()` if absent; never overwritten so
 * user edits survive.
 *
 * Includes a Decisions section: a decision is a note with
 * `kind: "decision"` (docs/homes-spec.md §9.7), found with the notes list's
 * Decisions filter and `kind` on list_notes and search. A title never makes
 * a note a decision.
 */

import { APP_NAME } from '@/constants/app';

export function renderBrainMemoryMd(): string {
  return `# ${APP_NAME} brain memory

Long-running scratchpad for the agent. Add facts you want available in
every future session: user role + working style, recurring projects,
naming conventions, "do not touch" lists, anything you'd otherwise
have to re-state at the top of each conversation.

## Decisions

A decision is a note with \`kind: "decision"\`. When you're asked to
record a decision, or one made during your work will need to be found on
its own later, call \`create_note\` with \`kind: "decision"\` and a title
that says what was decided, for example \`Switch transcript storage to
JSON Lines\`. In the body, write what was actually discussed in plain
prose: the choice, its context, the alternatives considered and why.
Leave out anything nobody said. Link the task it came from with a
\`[[task:<id>]]\` marker.

A conclusion that only matters to one task can stay in that task's body.
Not every conclusion needs its own note.

To make an existing note a decision, call \`update_note\` with
\`kind: "decision"\`. Find decisions with \`list_notes\` or \`search\`
and \`kind: "decision"\`, or the Decisions filter in Notes. Six months
later, "why did we decide X?" is one search, not an archeology project.
`;
}
