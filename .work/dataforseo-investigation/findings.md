# DataForSEO access investigation

Investigated October 12, 2026. Source checkout at investigation: `c735cc9ed06f`, including pre-existing working changes. The initial investigation did not change application source or production configuration. The subsequent user-requested fix is implemented in the working checkout and documented in `docs/integrations-recovery.md`. Production has not been restarted.

## Conclusion

The latest incident shows transport and tool-discovery failure, not evidence of permission revocation or an invalid API password. Ri has a reproducible runtime lifecycle defect that can interrupt active requests, followed by a discovery cache behavior that makes a brief failure look like lost access. The original server console history was not available, so the exact initiator of the incident's first socket close and the failed discovery's original response are not proven.

## Evidence from the two chats

Implementation chat: `01a11c65-8426-74d2-bfa1-9e308369723e`.

- Commits `78f4fa83` and `688f94bf` added hosted OAuth and API login/password support.
- On October 9 the chat separately diagnosed missing Codex MCP support. The connector was working in a Claude chat, but the totalfinance main chat on Codex had no Ri connector servers. That is a harness delivery problem, not expired credentials. The current Codex registry entry still lacks `mcp` and `strictMcpIsolation` maximum capability flags.

Failure chat: `01a13104-8bb2-7d2a-bc83-9934d3537432`, Claude session `667eaf9d-81e6-4e9c-a347-02eb95a66464`.

| UTC time on October 12 | Recorded evidence |
| --- | --- |
| Before 17:21 | Numerous paid API requests completed and returned provider results |
| 17:21:58 | `provider_unavailable`, `MCP error -32000: Connection closed`, `indeterminate: true` |
| 17:22:15 | Multiple calls returned `MCP error -32602: Tool dataforseo__api_request not found` |
| 17:23:40 | Even `dataforseo__docs_list_sections` returned tool not found |
| 17:27:09 | Chat reported Ri said DataForSEO was reconnected, but its tools had not reappeared |
| Through 17:37 | ToolSearch repeatedly found no DataForSEO tools |

The inspected failure window contains no `401`, `403`, `needs_reauth`, or credential rejection. Unknown-tool errors come from Ri's MCP gateway before a DataForSEO action can execute. A previous request with an indeterminate result may still have reached the provider. Discovery recovery must not automatically replay paid requests.

## Saved state at inspection

- Account label: InsiderFinance.
- Connection method: static API login/password. The store calls this `bearer`, but the DataForSEO catalog sends an HTTP Basic header.
- Static credential revision is unchanged from the account's October 9 creation. This account has no OAuth refresh flow.
- Connection metadata is `active`. The MCP server is enabled, its last discovery status is `ok`, and all four advertised tools are present, checked at 18:09:40 UTC.
- The totalfinance agent still has `integrationScopes: [{ toolkitId: 'dataforseo' }]`.
- Successful tool discovery alone does not verify the API password. DataForSEO checks Basic credentials when an API request runs. Previous successful data calls and the lack of an authentication rejection support the conclusion for this incident.

## Reproduced defects

### Refresh interrupts work already sent

`src/lib/integrations/runtime.ts`, `getBuilt` and `invalidateIntegrationRuntime`:

1. Cached discovery expires after five minutes.
2. The next access invalidates the runtime.
3. Invalidation immediately calls `close` on every old MCP client.
4. Nothing waits for active tool requests to finish.

Closing a client with a pending API request produces exactly the observed `Connection closed` result, marked indeterminate. Credentials remain active and unchanged. Explicit connection tests and configuration invalidation also use this close path.

### Failed discovery removes tools and delays recovery

Each replacement runtime reconnects and discovers every enabled server with a ten-second deadline. A failed account is marked unreachable and omitted from the registry. The partial runtime is cached for the same five minutes as a healthy one. Ri builds its MCP tool registry per request, so a tool the harness previously discovered then returns tool not found. If a harness reload happens during that window, it can discover an empty tool list and retain it after the server has recovered.

That last harness-cache explanation fits the reconnect mismatch but was not independently reproduced against the actual Claude process. The production runner also intentionally waits until a running turn ends before recycling a chat, which can delay delivery of new tools.

### A normal request failure does not invalidate the account

An ordinary transport failure from `api_request` returns `provider_unavailable`. It does not delete the saved static credential, change the connection to `needs_reauth`, or remove the tools from that same runtime. Provider tool errors are also distinct from typed transport authentication errors.

## Verification

Run from the repository:

```sh
pnpm exec vitest run src/lib/integrations/hosted-multiaccount-runtime.test.ts src/lib/integrations/mcp-client-lifetime.test.ts src/lib/integrations/mcp-servers.test.ts
pnpm --filter @integrations/engine test
```

All three initial diagnostic tests passed against the pre-fix behavior. They have been replaced by permanent regression tests that verify graceful retirement, retained tool definitions, short recovery cooldown, no automatic replay, preserved credentials, genuine authentication rejection, account revocation, ordinary API errors and redacted health history. These tests use temporary homes and synthetic credentials. They do not contact DataForSEO, spend account balance, open the production database, or restart either server.

## Implemented correction

- Retire MCP clients only after already-started operations finish. Prevent new dispatches on retired or revoked transports while retaining current lifecycle authority checks.
- Preserve the last verified tool definitions during a temporary discovery outage and return a structured unavailable result. Do not claim the account is authenticated merely because schemas are cached.
- Retry failed discovery with a shorter bounded backoff instead of retaining an empty registry for five minutes. Keep genuine credential rejection separate from timeouts and network failures.
- Keep the verified tools discoverable throughout temporary outages, so existing chats retain their tool list and can retry after recovery without a harness restart.
- Persist redacted, bounded health transitions with failure phase, authentication versus availability, HTTP status when available, and timestamps. The last twenty transitions now survive recovery in MCP server metadata.

Official [DataForSEO server source](https://github.com/dataforseo/mcp-server-typescript) confirms the four-tool hosted server and its OAuth and API credential modes. The local qualification document is `docs/integration-audit/eighth-wave-dataforseo.md`.
