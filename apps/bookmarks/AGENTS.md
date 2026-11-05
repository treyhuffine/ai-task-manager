# Maintaining Bookmarks

Bookmarks is an included Ri app (`ri-bookmarks`). It runs as a native Node app over `ri-ipc-v1` with `node:sqlite`, and its view is one self-contained HTML resource built from React with the Ri app kit. The design is in `docs/bookmarks-app-spec.md`.

## Layout

- `src/actions.ts` exports `definition`, `initialize` and `shutdown`. Importing it must not open the database or do I/O, because the build imports it to generate `contract.json`.
- `src/schemas.ts` holds strict inputs and outputs. The view imports types only from it.
- `src/domain/` is pure: link matching (`url.ts`), bookmark files (`parse.ts`), page text (`page.ts`) and client setup (`client.ts`).
- `src/db/migrations.ts` holds the forward-only schema. `src/services/` holds records and search (`core.ts`), page reading, imports and the view opener.
- `src/view/` is the React view. It may import only `@ri/app-kit/ui`, `@ri/app-kit/time` and types from `src/schemas.ts`.
- `extension/` is the browser extension: plain JavaScript that loads unpacked as it is, with no build. `extension/lib.js` holds the logic that has no browser in it, so it can be tested.

## Rules

- A client key adds and never reads. `requests.clientActions` in `plugin.json` is the whole list of what such a key reaches. Nothing they return may reveal a saved link, or whether one was already saved, and `test/contract.test.ts` holds that line.
- One page, one record. Every save goes through `saveOne`, which merges a repeat by `url_key`. Never overwrite a title or note the owner wrote: `TITLE_RANK` says who wins.
- Page text is untrusted. Keep the label in the context and never act on it.
- Reading a page happens through the host's `read_web_page`, never `fetch` in the app, so the private-network floor can't be bypassed. One bounded step per schedule call. No loops or timers.
- Search text and page text live in `bookmarks_fts`, keyed by `bookmarks.seq`. Change a record through `saveOne`, `edit`, `recordPage` or `remove`, which keep them in step.
- A chat sees everything or nothing: one source, `saved`. Call `t.resolve` before any read or write. Owner-only actions call `requireOwner`.
- Migrations are forward only. Policy values live in the query layer, never in SQL defaults.
- Copy has no em or long dashes and avoids semicolons. No sparkle or wand icons.

## Changing the extension

Run `pnpm --filter ri-bookmarks extension:package` after any change in `extension/`. It rewrites the copy embedded in `src/extension-package.generated.ts` and the store zip in `release/`, and `test/extension.test.ts` fails until you do. Raise the version in `manifest.json` and `plugin.json` together. `docs/chrome-web-store.md` holds the listing.

## Release

Run `pnpm --filter ri-bookmarks typecheck`, `pnpm --filter ri-bookmarks test` and `pnpm --filter ri-bookmarks package`. `test/view.test.ts` and `test/extension-browser.test.ts` need the package and a Chromium. Look at the screenshots in `artifacts/` before shipping a view change. Do not claim a real browser install or store review from these tests.
