# Plugin setup help

**Get setup help** sends a setup request to Ri's current main chat and opens that chat. The button is available in every connector's setup and connected-account view, the custom MCP add and detail views, the Skills catalog and skill builder, and the interactive plugin examples. It works before required setup fields have been filled in and after a connection failure.

The request identifies the selected connector, plugin, skill or MCP server. Connector context includes the current deployment, region or instance URL, authentication method, setup guide, saved account identifiers and connection status. A saved account's endpoint and authentication take precedence over stale form drafts. OpenSEO self-hosted requests carry the selected Docker or Cloudflare instructions rather than the hosted API-key instructions. Skill context includes its reference, installation location and whether validation errors are present.

Context uses an explicit field allowlist. Credential values, skill bodies and raw remote error messages are excluded. URLs lose user/password, query and fragment data, and recognized credential paths are redacted. Chat attachment markers and context-closing tags in names cannot cause files to be expanded into the request. Normal connector access and approval controls remain in force. The agent can investigate setup and guide the user through browser sign-in or credential entry in Settings. Clicking help does not itself connect an account, install a plugin or grant a tool permission.

## Delivery and navigation

The client resolves the app's existing main chat through `orchestratorChat.list`, which ensures one if absent. It sends through `sessions.messagesPost`, the same message transport as the composer. It does not archive the current chat, start a new unrelated execution or target the currently selected workspace's chat. Normal dispatch, budget, pending-input and active-turn behavior apply.

The button stays pending during delivery and prevents double clicks. A failed send leaves Settings open, shows an error, and retains the same message ID and destination for retry, so an uncertain acknowledgment cannot duplicate the request. Once acknowledged, the client invalidates the chat caches, closes Settings and shows the main chat on desktop or mobile. Existing composer drafts are not changed.

## Validation

Unit tests cover hosted, self-hosted, native and regional connector context, saved endpoint authority, credential and marker exclusion, custom MCP and skill context, existing-main-chat delivery, and retries after resolution or acknowledgment failure. The relevant connector, skill and session message suites also run.

`pnpm exec tsx scripts/plugin-setup-help-browser-smoke.ts` exercises the real OpenSEO form, custom MCP add/detail views, skill header, tRPC client and dashboard navigation in a disposable fixture at 1440px and 390px. It verifies main-chat routing from another agent's view, credentials staying out of messages, errors leaving Settings open, retries reusing the same event ID, and successful navigation. Every API call is intercepted. No real Home, agent message or connector request is used.
