import type { AnyPanelTab, PanelId } from '@/types/dashboard';

/**
 * Home's two panels and which side each tab calls home: the chat (the
 * orchestrator) on the left, the deck on the right. `resetLayout` returns
 * here.
 */
export const DEFAULT_HOME_PANELS: Readonly<Record<PanelId, AnyPanelTab>> = { a: 'chat', b: 'deck' };

/**
 * Which panel should switch to show `tab`, or null when it's already on
 * screen. The chat is never displaced to show something else: it takes the
 * left when it isn't showing, and every other tab takes the right, or the
 * left when the chat has been moved to the right.
 */
export function panelForTab(panels: Readonly<Record<PanelId, AnyPanelTab>>, tab: AnyPanelTab): PanelId | null {
  if (panels.a === tab || panels.b === tab) return null;
  if (tab === 'chat') return 'a';
  return panels.b === 'chat' ? 'a' : 'b';
}
