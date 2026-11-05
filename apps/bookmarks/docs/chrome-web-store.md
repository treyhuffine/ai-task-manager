# Publishing the extension

Everything the Chrome Web Store asks for, ready to paste. Publishing needs the owner's account, so this is not automated.

## Steps

1. Register a developer account at https://chrome.google.com/webstore/devconsole and pay the registration fee.
2. Run `pnpm --filter ri-bookmarks extension:package` and upload `apps/bookmarks/release/ri-bookmarks-extension-<version>.zip`.
3. Fill in the listing and privacy tabs from this file. Add the 128 pixel icon from `extension/icons/128.png` and at least one 1280 by 800 screenshot of the popup or options page.
4. Host the privacy policy below at a public address and give its link.
5. Choose Unlisted to try it, or Public. Submit for review.
6. When it is live, set `EXTENSION_STORE_URL` in `apps/bookmarks/src/extension-store.ts` to the listing. The Connect screen then offers Add to Chrome instead of the download.

Brave, Edge and Arc can install from the same listing.

## Listing

**Name:** Ri Bookmarks

**Summary:** Save links to your own Ri. Keeps your normal bookmarks in step and saves the text of the page you are reading.

**Category:** Productivity

**Description:**

Ri Bookmarks saves links to your own Ri, the app you run yourself. Nothing goes to anyone else.

Bookmark the way you always do. Anything you save with Cmd+D is copied to Ri. Press the toolbar button, or Alt+Shift+S, to also save the text of the page you are looking at, so you can find it later by what it said, even if it was behind a login. Bring in the bookmarks you already have with one click, with folders as tags.

You need a Ri to connect to. In Ri, open Bookmarks, then Connect, and make a connection code. The code can add links and nothing else.

## Single purpose

Save web links, and optionally the text of the current page, to the Ri instance the user connects it to.

## Permission justifications

| Permission | Why |
| --- | --- |
| `bookmarks` | Copies bookmarks the user makes to their Ri, and imports existing bookmarks when they ask |
| `activeTab` | Reads the current page's address and title when the user presses the button or shortcut |
| `scripting` | Reads the text of the current page when the user presses the button or shortcut. It runs only then, only on that tab |
| `storage` | Keeps the connection and any links waiting to send |
| `alarms` | Retries links that could not be sent |
| Optional host access | Requested once, for the one address of the user's own Ri, when they connect. No other site is reached |

The extension uses no remote code.

## Data disclosure

Collected, only when the user acts: website content (the page text, when they press save) and web history in the narrow sense of the links they choose to save. It goes only to the Ri address the user connected. The developer receives nothing. It is not sold, not used for anything else and not used to judge creditworthiness.

## Privacy policy

Ri Bookmarks sends the links you save, their titles, any tags and notes you add and, when you press its button, the text of the current page, to the Ri address you connect it to. That is software you run yourself. The extension sends this data nowhere else, and its developer never receives it.

The connection code and any links waiting to send are kept in your browser. Disconnecting removes the connection. Removing the extension removes everything it stored in your browser. Links already saved stay in your Ri until you delete them there.
