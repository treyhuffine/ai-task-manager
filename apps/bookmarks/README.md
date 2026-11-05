# Bookmarks

Save a link from anywhere, then find it by what the page said, or ask an agent. There are no folders to maintain. Folders in an imported file become tags, and tags stay optional.

## What it does

- **Bookmarks**: search first, then your links, newest first. Search covers titles, links, notes, tags and saved page text. Selecting a link shows its note, tags and what the page said.
- **Connect**: the browser extension, an iPhone Shortcut and a bookmarklet, with everything connected and a way to remove it. Each connection gets a key that can add links and nothing else.

## Ways in

| Path | What happens |
| --- | --- |
| Extension, Cmd+D | Your normal bookmark is copied here, link and title |
| Extension, toolbar button or Alt+Shift+S | Saves the tab with the text you can see, including logged-in and paywalled pages |
| Extension, Import | Copies everything already in the browser, folders as tags |
| Bookmarklet | Opens a small window that saves the page, using your Ri sign-in |
| iPhone Shortcut | The share sheet posts the link to your Home |
| Chat | An agent you've shared Bookmarks with calls `save_bookmark` |
| File | Browser HTML export, Raindrop HTML or CSV, any CSV with a url column, or pasted links. Previewed before anything changes |

The same page saved twice is one record. A repeat adds new tags and never overwrites a title or note you wrote.

## Reading pages

A saved link with no page text waits to be read. Turn this on in the app's Sources dialog. Every five minutes, one step reads up to twelve pages, spread across sites, through Ri's `read_web_page`, which carries no sign-ins and refuses private networks. A page that fails keeps its link, title and note, and says why.

Saved text is reference material from the web. It is labeled that way for any chat that reads it.

## Limits

- One import holds 50,000 links and a file up to 32 MB
- A page keeps up to 200,000 characters, and 3 MB of HTML is read
- PDFs are saved without text
- The view shows a site's initial rather than its favicon, since app views never reach the network

## Sharing with a chat

A chat sees nothing until you share. Bookmarks are shared as a whole, read only or read and write. Deleting and connecting stay with you.

## Developing

See `AGENTS.md`. All test data is fictional.
