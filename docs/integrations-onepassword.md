# 1Password connector

Ri connects to the official [1Password Environments MCP server](https://www.1password.dev/environments/mcp-server) through the `1password-mcp` executable installed by 1Password Desktop. It uses local stdio, with no JavaScript SDK, service account, remote bridge or credential pasted into Ri.

## Setup

1. Install and sign in to 1Password Desktop on the computer running Ri's server.
2. In 1Password Settings > Labs > MCP Server, enable the local MCP server.
3. In Settings > Developer, enable **Integrate with MCP clients**. The `1password-mcp` command must be available on Ri's `PATH`.
4. Create an Environment in 1Password for the project or company.
5. In Ri, open **Settings > Connectors > 1Password** and select **Connect 1Password**.
6. Enable 1Password in the agent's connector selection, then use a Claude Code chat. Ri currently attaches its scoped connector MCP to Claude Code. Other harnesses do not yet support this route.
7. Approve the Environment request in 1Password Desktop when the chat asks to use it.

The connector's setup panel links to the official MCP setup guide and a [Cursor authorization screenshot](https://1password.com/blog/the-1password-environments-mcp-server-is-now-on-cursor-marketplace) showing the 1Password prompt.

Ri's browser UI works with this connector because the local server launches the MCP process. Opening Ri from another computer does not move 1Password access to that computer. The desktop app and MCP executable belong on the Ri server's host, and local `.env` mounts belong to that host's filesystem.

## Scope

This is an Environments connector. It discovers the provider's tools for listing and creating Environments, managing variables, authenticating and mounting local `.env` files. It does not provide general vault or password-item access. Secret values stay out of tool responses, while 1Password makes them available to the processes that read an authorized `.env` mount.

Use separate Environments for projects or companies. Ri's existing agent selection controls whether an agent gets the 1Password tools. It does not restrict an enabled agent to a particular Environment or vault. 1Password handles interactive Environment authorization, which can be remembered until the desktop app locks. A mounted file can be read by other local processes while unlocked, so separate Environments are organization, not a per-agent sandbox.

Ri applies the existing connector approval policy to mutations, with a high default risk. Connecting discovers tools without reading secret values. Disconnecting removes the tools and closes Ri's MCP subprocess. It does not delete Environments or remove previously mounted files. Manage those in 1Password.

## Implementation and validation

The built-in catalog pins `1password-mcp`. The saved `stdio:1password-mcp` value is an identity marker, not a network endpoint. Custom MCP URLs cannot launch commands, and the local connector accepts no credentials or replacement endpoint. The shared MCP client uses the SDK's process transport without a shell, drains stderr without logging it, and closes the process on failed connection or runtime invalidation.

Subprocess fixture tests cover discovery, tool calls, agent exclusion and inclusion, mutation approval, missing installation, trusted command selection and process cleanup on disconnect. Catalog and Settings tests cover the entry and desktop setup instructions. These tests use a synthetic local server, not captured vendor schemas or real secret values. Live 1Password authorization still requires acceptance testing with an installed desktop app.

Sources: [MCP setup and tools](https://www.1password.dev/environments/mcp-server), [Environments](https://www.1password.dev/environments), [local `.env` files](https://www.1password.dev/environments/local-env-file).
