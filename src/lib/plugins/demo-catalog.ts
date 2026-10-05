/** Temporary evaluation presets, not an installed-plugin registry. */
export const PLUGIN_DEMOS = [
  { id: 'excalidraw', name: 'Excalidraw', description: 'Draw and edit a workflow diagram.', access: 'No account', source: 'https://github.com/excalidraw/excalidraw-mcp' },
  { id: 'flint', name: 'Microsoft Flint', description: 'Explore charts with sample revenue data.', access: 'No account', source: 'https://github.com/microsoft/flint-chart' },
  { id: 'buildings', name: 'Building explorer', description: 'Explore public building records on a map or in a table.', access: 'No account', source: 'https://github.com/DaveGold/mcp-metadata-demo' },
  { id: 'tldraw', name: 'tldraw', description: 'Draw on a canvas and share its context with the demo chat.', access: 'No account', source: 'https://tldraw.dev/blog/tldraw-mcp-app' },
  { id: 'asana', name: 'Asana', description: 'Search tasks and review task or project drafts.', access: 'Account and registered OAuth app', source: 'https://developers.asana.com/docs/mcp-tools-reference' },
  { id: 'figma', name: 'Figma', description: 'Try interactive diagrams exposed by your authorized account.', access: 'Account and approved client', source: 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/' },
  { id: 'posthog', name: 'PostHog', description: 'Explore analytics query results as charts and tables.', access: 'Sign in or personal API key', source: 'https://github.com/PostHog/posthog/tree/master/services/mcp' },
] as const;

export const ACCOUNT_DEMOS = ['asana', 'figma', 'posthog'] as const;
export type AccountDemo = typeof ACCOUNT_DEMOS[number];
