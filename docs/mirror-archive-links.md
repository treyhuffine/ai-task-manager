# Mirror archive link fidelity

The database keeps stable `[[task:ID]]` and `[[note:ID]]` markers. Rendering resolves each target's current title and lifecycle to its actual vault path, including `.archive/` for archived tasks, notes and areas and dismissed streams. Archiving or restoring a task or note also refreshes the mirror files of its indexed inline backlinks. Existing foreign-key and stream-provenance cascades use the same archive-aware resolver.

Attachment URLs remain unchanged in stored content. Active mirror documents render `../attachments/`, while archived documents render `../../attachments/`. Quoted capture sources use the containing document's location. Attachment bytes and metadata are not modified by this rendering.

`flow export` forces a complete render, including records with unchanged timestamps. This repairs older exports after renderer changes. Background reconciliation retains its normal timestamp skipping. Mirror files remain managed exports, so edits go through the app, MCP or agent CLI, never manual edits to the mirror.

Verification lives in `src/lib/export/mirror/archive-links.test.ts`. It covers task and note inline backlinks, rename, archive and restore, area and task relationships, stream provenance, attachment paths, original database content and attachment-byte preservation, and forced versus normal reconciliation.
