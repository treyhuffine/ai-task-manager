/** Keep the registry separate from the layouts so preferences never load the screens. */
export const LAYOUT_OPTIONS = [
  { id: 'discover', name: 'Discover first', description: 'Quick access above an open catalog.' },
  { id: 'split', name: 'Split library', description: 'Your library and discovery, side by side.' },
  { id: 'rail', name: 'Apps rail', description: 'Your additions in the rail, discovery in the workspace.' },
  { id: 'collection', name: 'One collection', description: 'Installed and available, organized by purpose.' },
  { id: 'home', name: 'Home discovery', description: 'Discovery alongside your chat and daily work.' },
  { id: 'chat', name: 'Beside your chat', description: 'Browse while a real conversation stays open.' },
  { id: 'preview', name: 'Preview browser', description: 'A compact list with room to explore each addition.' },
  { id: 'bundles', name: 'Goal bundles', description: 'Start with what you want to accomplish.' },
  { id: 'tabs', name: 'App tabs', description: 'Discovery and open apps share a tab strip.' },
  { id: 'control', name: 'Control center', description: 'Manage what Ri can use while finding more.' },
  { id: 'agent', name: 'Agent tools', description: 'Start with an agent and what it can use.' },
  { id: 'shelf', name: 'Discovery shelf', description: 'Keep an app open with discovery below it.' },
] as const;

export type LayoutId = typeof LAYOUT_OPTIONS[number]['id'];
export type LayoutChoice = LayoutId | 'original';
export function isLayoutChoice(value: unknown): value is LayoutChoice {
  return value === 'original' || LAYOUT_OPTIONS.some(option => option.id === value);
}
