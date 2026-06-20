/**
 * Verifies the note/task change-versioning + revert backbone end-to-end
 * against the real DB (the same path the dev server uses). Run with:
 *   FLOW_ROOT="$HOME/flow-dev" pnpm tsx scripts/verify-entity-versions.ts
 *
 * Leaves its test note in place (dev convention) so the result is visible
 * in the UI.
 */
import {
  createNote,
  updateNote,
  listEntityVersions,
  revertEntityTo,
} from '@/lib/db/queries';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ok — ${msg}`);
}

async function main() {
  console.log('1. create note');
  const note = createNote({
    title: 'Versioning smoke test',
    body: 'Line one.\nLine two.\nLine three.',
  });
  console.log(`   note ${note.id}`);
  assert(listEntityVersions('note', note.id).length === 0, 'no versions on fresh create (lazy)');

  console.log('2. human edit (body)');
  updateNote(note.id, { body: 'Line one EDITED.\nLine two.\nLine three.' });
  let versions = listEntityVersions('note', note.id);
  assert(versions.length === 2, 'first edit seeds baseline + new version (2 rows)');
  assert(versions[0].source === 'human', 'newest version is human-sourced');
  assert(versions[1].snapshot.body === 'Line one.\nLine two.\nLine three.', 'baseline holds pre-edit body');

  console.log('3. ai edit (title + body)');
  updateNote(
    note.id,
    { title: 'Versioning smoke test (AI)', body: 'Line one EDITED.\nLine two.\nAI appended line.' },
    { source: 'ai', summary: 'AI rewrite' },
  );
  versions = listEntityVersions('note', note.id);
  assert(versions.length === 3, 'ai edit appends a 3rd version');
  assert(versions[0].source === 'ai', 'newest version is ai-sourced');

  console.log('4. no-op meta edit does not create a version');
  updateNote(note.id, { lastViewedAt: new Date().toISOString() });
  assert(listEntityVersions('note', note.id).length === 3, 'non-content bump skipped');

  console.log('5. undo the AI change (revert to the version before it)');
  const beforeAi = versions[1];
  const reverted = revertEntityTo(beforeAi.id);
  assert(reverted?.record.body === beforeAi.snapshot.body, 'entity body restored to pre-AI snapshot');
  assert(reverted?.record.title === beforeAi.snapshot.title, 'entity title restored to pre-AI snapshot');

  const afterRevert = listEntityVersions('note', note.id);
  assert(afterRevert.length === 4, 'revert is itself recorded as a new version');
  assert(afterRevert[0].source === 'system', 'revert version is system-sourced');
  assert(afterRevert[0].revertedFromVersionId === beforeAi.id, 'revert links to the restored version');

  console.log(`\n✅ All version/diff/undo assertions passed. Test note: ${note.id}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌', err);
    process.exit(1);
  });
