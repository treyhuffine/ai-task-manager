# Repair copied-note attachment metadata

Copying a note body preserves attachment URLs but can create manifest stubs with the storage filename as the display name, `application/octet-stream`, size `0`, and a new upload timestamp. Normal note updates intentionally preserve existing metadata, so resubmitting upload hints does not replace those stubs.

Use the trusted local orchestrator action when another existing note has the authoritative upload metadata:

```sh
ri agent describe_paths
ri agent repair_note_attachment_metadata --input '{"source_note_id":"<original-note-id>","target_note_id":"<copied-note-id>","file_names":["<storage-filename>.png"]}'
ri agent get_note <copied-note-id>
```

The required parameters are `source_note_id`, `target_note_id`, and `file_names` (1 to 100 distinct storage filenames, never paths). The result includes `sourceNoteId`, `targetNoteId`, `repairedFileNames`, and `unchangedFileNames`. HTTP MCP and unspecified remote contexts return `unsupported`.

The action only repairs existing generated stubs. Each selected filename must be referenced in both note bodies, have exactly one record in each manifest, and identify a regular, non-symlink file in the configured attachments directory. The source must have a nonempty original name, an allowed MIME type consistent with its storage extension, a positive integer size matching the file, and a valid upload timestamp. Missing notes or files return `not_found`. Incomplete sources, unreferenced or ambiguous records, storage mismatches, and non-stub target conflicts return `conflict`. Invalid selections return `invalid_params`.

The entire batch is validated in a write transaction before any metadata changes. The query layer copies only `originalName`, `mimeType`, `size`, and `uploadedAt` for the selected stubs. It preserves filenames, file bytes, bodies, links, unrelated attachment records, and other note fields. The normal `updatedAt` timestamp advances only if metadata changed. Content history and embeddings stay untouched because no content or embedding text changed. Mirror sync is awaited after commit and on retries.

Retrying the same repair does not rewrite already matching metadata or bump `updatedAt`. This is not a general metadata editor, file importer, MIME detector, or cross-installation attachment copier. Keep an authoritative source note available until verification is complete.

Verification:

```sh
pnpm exec vitest run src/lib/attachments/repair-metadata.test.ts src/lib/db/queries.attachment-repair.test.ts src/lib/orchestrator/registry.attachment-repair.test.ts
pnpm ts
```
