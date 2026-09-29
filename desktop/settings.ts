import type { DesktopSettingsAction } from '../src/lib/client/desktop-settings';

/** This bridge can configure only two desktop preferences, never native APIs. */
export function desktopSettingsAction(value: unknown): DesktopSettingsAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid desktop setting');
  const action = value as Record<string, unknown>;
  const keys = Object.keys(action).sort().join(',');
  if (action.type === 'status' && keys === 'type') return { type: 'status' };
  if (action.type === 'login' && keys === 'enabled,type' && typeof action.enabled === 'boolean') return { type: 'login', enabled: action.enabled };
  if (action.type === 'shortcut' && keys === 'accelerator,enabled,type' && typeof action.enabled === 'boolean' && typeof action.accelerator === 'string' && action.accelerator.length <= 80) return { type: 'shortcut', enabled: action.enabled, accelerator: action.accelerator };
  throw new Error('Invalid desktop setting');
}
