# Links to records in a team

How a link reaches a task, note or Area that lives in another Home. Personal use with no team is unchanged by all of this.

## The rule

A link with no Home means a record in the Home that owns the text.

| Written | Means | Where it appears |
| --- | --- | --- |
| `[[task:<id>]]` | A record in the Home that owns this text | Everywhere, as always. In a team's text it's that team's record |
| `[[task:<home id>/<id>]]` | A record in the named Home | My Ri's chats and personal bodies. Also `note`, and `area` in chat |

A link holds a Home and an ID, never a title or an address. So it can't carry a title anywhere, it can't outlive access to the team, and it keeps working when a team moves. The `/` is outside the ID characters older parsers accept, so a build that doesn't know the form shows plain text instead of looking up the wrong record.

## What agents write

Team tools called through My Ri put a `ref` on every record in their result, added in `callConnectedHome` so it works with a team on any version. An agent copies it. Its `link` is a web address for sharing outside Ri.

Text on its way to a team passes through `linksForTeam` (`src/lib/spaces/team-links.ts`), the only place that can see both sides:

- A shared copy's local ID becomes the team's ID.
- The team's own `ref` becomes a bare link.
- A link to a private record, or to another team's, is refused for an agent, naming the link and sending nothing. A person's editor autosaves and can't act on a refusal, so it sends what they typed. The `@` menu in a shared body only offers that team's records.

A team's direct MCP clients only ever have team IDs, so their tools are unchanged.

## Reading a link

`spaces.record` asks the team with the title lookup, which never counts as a view. A bare ID that isn't in this Home goes to `spaces.locateRecord`: this Home first, then shared copies, then every connected team at once. It stops at this Home, so a private ID is never sent to a team. With no teams it makes no request. It only runs in My Ri's chats and personal bodies, because a team's text only ever looks in that team.

The mirror, link index and message expansion run with no network, which is why the Home has to be in the link itself. The lookup is only a net for old chats and agents that skip `ref`.

## Click and failure states

| State | Shows | Click |
| --- | --- | --- |
| Found, with a shared copy | Title and team | Opens the copy in place |
| Found, no shared copy | Title and team | This tab: the team's view, on `/space/<team>`, with no second sign-in |
| Archived | Title, marked archived | As above |
| Team offline | "Ball Coach task", can't reach it | The team's view, which explains and retries |
| Different version | "Ball Coach task", update the older one | Nothing, since no request to that team can work |
| Access removed | "Ball Coach task", no longer have access | Nothing |
| Gone | "Ball Coach task", no longer in it | Nothing |
| Unknown Home | "Task in another Ri" | Nothing |

In every state but the last two, a shared copy supplies the title and opens in place. Inside a team's text, teammates get the same "Task unavailable" for a private ID, a typo and a missing record, so nothing can be learned by probing.

A task opens in a slide-over on the team's board. A note opens over the team's Notes. An Area has no page, so it opens the team's board filtered to it. Team chats, published results and files have no link form yet. A team chat's `link` works as a plain link, and publishing already copies a chosen file to the team.

## Privacy

- **Team to personal:** a team holds no credential for My Ri, so a private ID in team text can't resolve. Agents are stopped from writing one. Its only content is an ID, whose first characters say when the record was made.
- **Personal to team:** a link in a private note stays in My Ri's link index. It shows on a shared copy's Linked references, marked Only you. The team's `list_links` never sees it.
- **After access ends:** a link with no shared copy has no title to show, and nothing was saved to purge. A shared copy keeps its title and private planning, as `releaseTeamContent` always has, so a person can still tell what it was. Prose someone wrote stays, like any export.
- **Between teams:** the lookup can send one team's ID to another team's server. It holds nothing but the ID.

## Existing data

Nothing is migrated and no chat is rewritten. `[[task:<id>]]` stays valid forever. A dead chip in an old chat starts working if the lookup finds its record, and otherwise stays not found.

## Not built

- Links from one team's text to another team's records.
- Team-only records in My Ri's `@` menu. Shared copies are already offered.
- A saved title cache.
- Team links in a chat's Notes & tasks panel, since `chat_refs` holds rows of this Home.
