# Bookmarks app

> **Removed from Ri on November 12, 2026.** Ri no longer bundles apps. This app is to be ported later as its own app built with the shared app kit, connected to Ri over MCP (see [personal apps](personal-apps.md)). Its source is in git history at `3c442810` (`apps/bookmarks`). What it does still stands. The packaging, permissions and host details below describe Ri's former app system, and the linked foundation documents are in git history at the same commit.

November 5, 2026. An included Ri app (`apps/bookmarks`, package `ri-bookmarks`) that keeps every link you save, finds it again by what the page said, and lets your agents use it. It follows the [included apps foundation](included-apps-foundation.md) except where this document says otherwise.

## What it is

Save a link from anywhere, then search for it or ask an agent. There are no folders to maintain. Folders in an imported file become tags, so nothing is lost, and tags stay optional.

A saved link keeps the page's text. That text is what makes search useful, and it is the difference between this and a list of titles you never reopen. The app stores:

- the link, its title, when you saved it and how it arrived
- your note and any tags
- the page's text, read by the browser when you press the save button, or fetched by your Home otherwise

## Ways in

| Path | What happens | Needs |
|---|---|---|
| Browser extension, Cmd+D | A normal bookmark is copied to Ri. Link and title only | The extension |
| Browser extension, toolbar button or Alt+Shift+S | Saves the tab with the text you can see, including logged-in and paywalled pages | The extension |
| Browser extension, Import | Copies everything already in the browser's bookmarks, folders as tags | The extension |
| Bookmarklet | Opens a small Ri window that saves the page, with your existing Ri sign-in | A signed-in browser |
| iPhone Shortcut | Share sheet posts the link to your Home | A key |
| Chat | An agent calls `save_bookmark` | Access for that chat |
| File import | Browser export (HTML) or Raindrop export (CSV or HTML). A pasted list of links works too | Nothing |

A repeat save of the same link never makes a second record. It merges: new tags are added, a note is kept if you have one, and page text from the browser replaces fetched text.

Links are matched on a normalized form: lower-case scheme and host, no default port, no fragment (except `#/` and `#!` routes), no known tracking parameters (`utm_*`, `fbclid`, `gclid` and similar), no trailing slash. The link as saved is what opens.

Only `http` and `https` links are kept. Browsers hold `javascript:`, `chrome:` and `file:` bookmarks too, and those are counted as skipped.

## Reading pages

A save that has no page text waits for a background step. One step reads up to twelve pages within a 20 second budget, every five minutes through the host schedule, like every other included app. It takes each site's first page before any site's second and at most three from one site, so a library that is mostly one site still moves without crowding out the rest. Reading is off until the owner allows it in the app's Sources dialog, because it means Ri requests each saved link from the Home's address. The view says what search covers until then.

The fetch happens in the host, as the Ri capability `read_web_page`, not in the app:

- It sends no cookies or sign-ins.
- It refuses localhost, private networks and metadata addresses, checked where the socket connects and again on every redirect, so a public name that resolves to a private address is refused too.
- It follows at most five redirects, stops after 12 seconds and reads at most 3 MiB of HTML.
- Only `text/html` and `text/plain` are read. A PDF or image is recorded as saved without text.

A page that answers 404 or 410 is marked gone. A page that answers 401, 403 or 429 is marked as needing the browser, since the toolbar button can still save its text. Other failures retry up to three times with backoff. The record stays useful through all of this, because its link, title and note are searchable from the moment it is saved.

Saved page text is untrusted. Context for a chat labels it as reference material, not instructions.

## Keys for outside clients

The extension and the Shortcut run outside Ri, so they need a credential. A sign-in key would act as the owner across the whole Home, which is too much to leave in a browser extension. So the host gains one narrow thing, usable by any app:

- **A manifest field.** `requests.clientActions` names the actions a client may call. Each must exist, must have user audience and must not be an external write.
- **A key role.** `api_keys.role = 'app_client'`, with `client` holding the app instance ID. The proxy lets this key reach only `POST /api/local-apps/client/<action>`. Every other route, WebSocket and session cookie refuses it.
- **A route.** It checks the key's instance is enabled and the action is declared, then runs that action through the normal host path as the owner.
- **Three owner-only capabilities.** `create_client_key`, `list_client_keys` and `revoke_client_key`, for the app's own Connect screen. They need no separate grant: the manifest declares the door and a person presses the button. Removing the app revokes its keys.

For Bookmarks the only client actions are `save_bookmarks`, `save_link` and `describe_connection`. A stolen key can add links. It cannot read a single bookmark or reach anything else in Ri.

The key and the Home address travel together as one connection code, so setting up the extension is one paste.

## Extension

Plain Manifest V3 JavaScript in `apps/bookmarks/extension`, no build step, so the folder loads unpacked from the repository as it is. The same folder is what goes to the Chrome Web Store. `pnpm --filter ri-bookmarks extension:package` writes the store zip and the copy the app offers for download.

Permissions are the minimum that works: `bookmarks`, `storage`, `alarms`, `activeTab`, `scripting`, plus an optional host permission requested for your Home's address alone when you connect. Reading a page needs a click or the keyboard shortcut, because `activeTab` grants only that. This is why Cmd+D sends the link and title without text: reading the page on Cmd+D would need permission to read every site.

Saves wait in a persisted queue and retry, so a closed laptop or an unreachable Home loses nothing.

Publishing needs the owner's Chrome Web Store account. `apps/bookmarks/docs/chrome-web-store.md` holds the listing copy, permission justifications and privacy text.

## View

One working screen: search first, then the list. Selecting a record opens the shared inspector with its link, tags, note and page text. Tabs are Bookmarks and Connect. Connect holds the extension download and steps, connected clients with Remove, the bookmarklet and the Shortcut steps. Import is a dialog from the header.

The view is network free like every app view, so a row shows the site's initial rather than a remote favicon, and there are no thumbnails.

## Agents

A chat needs access like any other included app, through the standard account access flow. There is one source, `saved`, and the owner picks read or read and write. `list_bookmarks` (which searches when given a query), `get_bookmark`, `list_tags`, `save_bookmark` and `update_bookmark` are the model-visible actions.

## File size

A browser's export can run to many megabytes, mostly favicons held inline. The contract's cap on a selected file rises from 512 KiB to 32 MiB, and each package still declares its own limit. The view strips inline favicons and uploads the rest in parts under the 1 MiB action limit. Preview parses the whole file and shows counts. Apply takes the preview ID and digest, once. One import holds at most 50,000 links.

## Not in this version

- AI summaries and automatic tagging
- Semantic search. App-kit has no embeddings capability yet, so search is keyword over title, link, note, tags and page text
- Reading PDFs
- Deleting from Ri when you delete from the browser. Copying is one way on purpose
- A signed Safari extension. Safari users have the bookmarklet and file import

## How it was checked

Fictional data only. On a disposable Home with a real server: the app installed from the catalog, every client route and every refused route with a real key, real page reads of public sites, the private-address refusal, a real chat credential searching and saving, the bookmarklet in a signed-in browser, the extension in Chromium, and key revocation on archive and removal.

Not covered, because automation can't reach them: the browser's permission prompt when connecting, a real toolbar click and Cmd+D keystroke (the tests fire the same events), dragging the bookmarklet to a real bookmarks bar, a real iPhone Shortcut, and Chrome Web Store review.
