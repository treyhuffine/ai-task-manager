# Claude connector directory enumeration

Verified 2026-09-28 at 23:39:07 UTC against Anthropic's public website. This is a snapshot, not an assertion that the directory count stays fixed.

## Enumeration and reconciliation

- [The old directory URL](https://claude.com/connectors) redirects to [Connectors and plugins](https://claude.com/marketplace/connectors-plugins).
- The live page contains a complete connector inventory in its React Flight payload. Decode the string payload of each `self.__next_f.push([1, ...])` script in document order, concatenate them, and parse the component data object containing `items`. Do not scrape only visible cards.
- The full `items` array contains **861 connectors**, with unique `_id`, `slug`, and `directoryUrl` values. It includes **729 remote** connectors and **132 local desktop extensions**.
- [The official sitemap](https://claude.com/sitemap.xml) contains **861 unique `/marketplace/connectors/<slug>` URLs**. Its slug set exactly matches the embedded inventory. Both set differences are empty.
- The live HTML independently renders `Show all 861` and the accessible status `861 connectors`.
- The directory's public client bundle passes the complete array into `FilterHub` with `pageSize: 24`. Featured/top, trending, and new sections are subsets. Categories and types are filters. There is no default deduplication or hidden exclusion affecting the 861 count.
- A web extraction cache initially reported **855** connectors and **3** new connectors. Live fetched HTML reported **861** and **5**, respectively. This discrepancy is cached content, not six excluded entries.

## Scope and coverage limits

- This inventory includes builtin/Anthropic-maintained offerings such as Microsoft 365, plus Google Drive, Gmail, and Google Calendar. Do not interpret every listed connector as independently reusable or vendor-maintained.
- Plugins are a separate collection. The same page advertises **340 plugins**, but those are not included in the connector `items` array or this connector count.
- **686 remote entries publish a nonempty `serverUrl`**, all distinct. **43 remote entries** omit an endpoint. All **132 local entries** have no remote `serverUrl`. Missing endpoints require investigation of setup instructions and should not be invented.
- There are **17 official category values**. All local entries and the remote Airfield Directory entry have null official categories. Any audit bucket supplied for these entries is inferred and must remain separate from source categories.
- Six names have both a remote and local listing: ClickUp, Vibe Prospecting, Affinity, Coupler.io, Local Falcon, and Lumin. Three local entries are called Azure MCP Server. Preserve all their distinct IDs and slugs. In particular, same-title listings need not represent the same functionality.
- This proves coverage of the public directory snapshot, not every private/custom connector available inside a customer's Claude account, nor every MCP server on the internet.

## Reproducible source captures

Temporary evidence files were captured outside the repository. Their SHA-256 hashes identify the snapshots used for reconciliation:

The sitemap was captured at 2026-09-28 23:36:25 UTC and the HTML at 23:36:25 UTC. The parsed data file was written at 23:37:17 UTC. Capture times are UTC filesystem modification times.

| Source | Capture file | SHA-256 |
| --- | --- | --- |
| Public sitemap | `/tmp/claude-directory-sitemap.xml` | `b9718f504099a1c0fe27eec307d71b1f690abf61ce901a21bed7a938c40e4fe2` |
| Full directory HTML | `/tmp/claude-directory-page.html` | `8319125f2253e1fbc626d089c9645519ea3f868eb4c129b4d71bd0cb3d8f4f06` |
| Parsed directory data | `/tmp/claude-directory-data.json` | `ae697f28e308a80de6a0cb2fed1a28769479f81b8bbc55d700585117824d47cd` |
| [Public directory client bundle](https://claude.com/_next/static/chunks/bcc044c698ac03a3.js) | `/tmp/claude-dir-bcc044c698ac03a3.js` | `e4c53c4e7e49128c0a97aa1349753c5b942393b25a71478bb01b1edbeb82768c` |

The client bundle is an implementation detail for verification, not a supported API. The directory page and sitemap are the durable source links.
