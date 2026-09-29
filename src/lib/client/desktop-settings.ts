import { HOTKEYS } from '@/constants/commands';
import type { DesktopLoginStatus } from '../../../desktop/login';

export const DEFAULT_CAPTURE_SHORTCUT = [HOTKEYS.quickCapture.meta && 'CommandOrControl', HOTKEYS.quickCapture.shift && 'Shift', HOTKEYS.quickCapture.key.toUpperCase()].filter(Boolean).join('+');
export interface CaptureShortcutPreference { enabled: boolean; accelerator: string }
export interface CaptureShortcutStatus extends CaptureShortcutPreference {
  state: 'off' | 'active' | 'unavailable';
  detail?: string;
}
export type DesktopSettingsAction = { type: 'status' } | { type: 'shortcut'; enabled: boolean; accelerator: string } | { type: 'login'; enabled: boolean };
export interface DesktopSettingsStatus { shortcut: CaptureShortcutStatus; login: DesktopLoginStatus }
