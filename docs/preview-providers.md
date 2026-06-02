# Preview providers

A **preview provider** turns a worktree's running dev server into a URL you
can open. Flow ships four built-ins — `localhost`, `beamd`, `portless`,
`manual` — and exposes the same seam to community plugins so you can add
your own tunnel (ngrok, cloudflared, Tailscale, a corporate proxy, …)
without forking Flow.

This doc is the contract. If you implement it, your provider is a
first-class citizen of the reachability picker and the settings panel.

## The shape

A provider is a plain object implementing `PreviewProvider` from
`src/lib/preview/providers/types.ts`:

```ts
import {
  registerPreviewProvider,
  type PreviewProvider,
  type PreviewContext,
  type PreviewTarget,
  PreviewProviderError,
} from '@/lib/preview/providers';

const ngrokProvider: PreviewProvider = {
  id: 'ngrok',                 // stable, lowercase [a-z0-9-]; the public contract
  label: 'ngrok',              // shown in the settings picker
  kind: 'dynamic',             // 'dynamic' starts/stops a tunnel; 'static' = URL already exists
  managesLocalServer: true,    // does Flow need to run the dev server first? (default true)

  async resolve(ctx: PreviewContext): Promise<PreviewTarget> {
    // ctx gives you everything you need to produce a URL:
    //   ctx.port         — the local port the app is listening on
    //   ctx.previewName  — a valid single DNS label, e.g. "flow-a3f9" / "flow-a3f9-api"
    //   ctx.worktreeName, ctx.service, ctx.workspaceId, ctx.executionId
    const tunnel = await startNgrok(ctx.port, ctx.previewName);
    return {
      url: tunnel.publicUrl,
      stop: async () => { await tunnel.close(); },  // omit for static providers
    };
  },

  // Optional: gate the provider in the settings picker until it's set up.
  isConfigured() {
    return Boolean(process.env.NGROK_AUTHTOKEN);
  },
};

registerPreviewProvider(ngrokProvider);
```

## Field reference

| field | meaning |
| --- | --- |
| `id` | Stable identifier and wire contract. Lowercase `[a-z0-9-]`, starts alphanumeric. Renaming it breaks anyone who selected it. |
| `label` | Human-facing name in the settings picker. |
| `kind` | `dynamic` if `resolve()` brings something up that must be torn down (return a `stop`); `static` if the URL exists as soon as the dev server is up. |
| `managesLocalServer` | `true` (default) if Flow should start + confirm-listen the worktree's dev server before calling `resolve()`. Set `false` if your provider points at a server you don't manage (an external URL, or one another tool owns). |
| `resolve(ctx)` | The core method. Return `{ url, stop? }`. Throw `PreviewProviderError(code, message, hint?)` to surface an actionable status in the preview pane. |
| `isConfigured()` | Optional. Return `false` to grey the provider out in the picker until prerequisites are met. |

## `PreviewContext`

Everything `resolve()` is handed:

```ts
interface PreviewContext {
  worktreeName: string;       // "flow-a3f9"
  service?: string | null;    // "web" | "api" | null (the only/default service)
  port: number;               // local port the app listens on (confirmed up if managesLocalServer)
  workspaceId: string;
  executionId: string;
  previewName: string;        // "flow-a3f9" / "flow-a3f9-api" — a valid single DNS label
}
```

`previewName` is already sanitized to a single RFC-1123 label (≤63 chars,
lowercase `[a-z0-9-]`). Use it verbatim as your subdomain/route name — don't
re-derive one, and don't add dots (a tunnel name must be one label deep).

## Naming rule

Encode structure with **hyphens, not dots**: `flow-a3f9-api`, not
`api.flow-a3f9`. A nested label falls outside a one-label-deep wildcard cert
and won't resolve. `ctx.previewName` already follows this.

## Lifecycle expectations

- **Idempotent.** `resolve()` may be called repeatedly for the same context
  (lazy bring-up, reconnect after a network blip). If your tunnel is already
  up, return its existing URL rather than opening a second one.
- **`stop` is idempotent too.** It may be called when nothing is up.
- **Don't persist desired state.** Flow owns "what should be running"
  (`preview_targets`). Your provider only tracks currently-live sessions, so a
  Flow restart cold-starts cleanly instead of re-pointing at dead ports.
- **Fail loud, fail useful.** Throw `PreviewProviderError` with a stable
  `code` and a human `message` (+ optional `hint`). The pane renders it.

## Registering

Call `registerPreviewProvider(provider)` once at import time. To make Flow
load your plugin, import its module somewhere that runs at startup (e.g. a
small entry in `src/lib/preview/providers/index.ts`, or a user plugin
directory once that lands). Built-ins register in
`src/lib/preview/providers/index.ts`.

Once registered, your `id` appears in the settings "active remote provider"
picker, and selecting it routes every preview's `resolve()` to your code —
no other edits required.
