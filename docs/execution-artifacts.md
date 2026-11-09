# Execution artifacts

The Artifacts tool collects files shared across all chats on one execution, including archived chats. The list follows the execution when the person switches chat tabs. On desktop it opens in the tools panel. On a phone it opens from the tools sheet.

The source of truth is the saved conversation. Agent replies contribute local file links, images, inferred paths and visualize HTML markers using the same Markdown scanner as the transcript. Message attachments contribute their existing attachment metadata. Tool calls, thinking and user-written local paths do not create artifacts. No filesystem crawl, extra artifact record or agent registration step is needed.

Entries show their filename, original path and source chat. Repeated references to one file collapse to the newest reference. Relative and absolute paths inside the execution folder share an identity. Files retain their source chat when opened, so the existing preview routes apply their normal access checks. Missing files retain an entry and show the existing unavailable-file state.

Opening an entry uses the common artifact viewer and its copy, download, large view and beside placement controls. On desktop a file opens as its own panel tab, and closing it returns to Artifacts. Previous and Next stay within the artifact list rather than mixing it with transcript cards. The filename, path and chat filter applies to loaded entries. Load older messages extends the collection and filter.

`artifacts.list` is a typed tRPC query scoped by execution, with a session fallback for legacy chats without an execution. It authorizes the requested resource and filters sibling chats through the common catalog policy. Each page reads at most 51 candidate messages per chat through `idx_chat_events_artifact_message`, then merges them in memory to return 50 messages. The shared literal partial-index predicate excludes tool logs. A `(created_at, id)` cursor seeks into each chat independently, so paging does not sort a whole execution's events in SQLite or read provider raw payloads.

The client fetches only after the tool has been opened, refreshes every 15 seconds while it is visible and offers manual refresh. Search and loaded pages survive switches between chats on the same execution. The gallery's Execution artifacts example uses the same list and preview controls with fictional files.

Migration 0033 adds only the partial index. It applies when a Home's server next starts, through the normal migration runner.
