# Editor suggestion menus

Notes, tasks, chat composers and the New chat prompt use the shared renderer
in `src/components/chat/editor/suggestion/renderer.ts`. Chat and document `@`
menus match the editor width and prefer opening above the trigger. Document
slash commands retain their narrower menu and prefer opening below it.

The popup stays inside the nearest Radix dialog or popover so modal pointer
handling permits clicks and scrollbar drags. Floating UI positions it against
a virtual reference built from Tiptap's current suggestion rectangle. It resolves
the actual fixed containing block, whether the mount host has a transform or
uses ordinary viewport positioning.

Do not subtract the mount host's rectangle unconditionally or calculate `bottom`
from `window.innerHeight`. A plain dialog does not establish a fixed containing
block, and a transformed dialog's height differs from the window's height. These
calculations detached menus from their triggers and clipped them on mobile.

The renderer flips the menu when needed and constrains it to the visible viewport,
including the space above a mobile keyboard. Long menus scroll. Position updates
follow ancestor scrolling, viewport resizing, result list resizing and dialog
animations. A trigger scrolled out of view hides its menu. Escape, suggestion exit
and editor destruction stop all positioning observers and remove the popup.

Run the browser regression with:

```sh
pnpm exec playwright-core install chromium webkit
pnpm exec tsx scripts/editor-suggestions-browser-smoke.ts
```

It uses a real Tiptap Suggestion plugin with disposable items and no Home. It
covers Chromium and WebKit at desktop, 390px and 320px widths, including body,
plain dialog, translated/scaled dialog, slideout and popover hosts. Each case
checks scrolling, asynchronous list growth, simulated visual viewport keyboard
changes, mouse selection, Escape and teardown. Screenshots go to
`.work/editor-suggestions/`.
