'use client';

import { useSyncExternalStore } from 'react';
import { DEFAULT_SECTION, type SectionId } from './settings-sections';

/**
 * Imperative open/close store for the unified settings modal.
 *
 * Module-level so any surface — a deep preview-pane CTA, the mobile "More"
 * menu, the command palette, the top-HUD gear — can open the modal (optionally
 * on a specific section) without threading a handle through the React tree.
 * Mirrors the pattern the old `openBeamdSheet()` / `openRemotePreviewSettings()`
 * helpers used, but unified behind one store. `<SettingsModal/>` is mounted once
 * and subscribes via `useSettingsStore()`.
 */
interface SettingsState {
  open: boolean;
  section: SectionId;
  /**
   * True when the modal was opened generically (the gear / palette / mobile),
   * as opposed to a CTA targeting a specific section. The modal consumes this
   * to land on "Get started" while setup is incomplete; an explicit section
   * (budget pill, preview CTA, deep link) leaves it false so the target wins.
   */
  autoLand: boolean;
}

let state: SettingsState = { open: false, section: DEFAULT_SECTION, autoLand: false };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Open settings. With a section → land there. Without → let the modal choose. */
export function openSettings(section?: SectionId): void {
  state = section
    ? { open: true, section, autoLand: false }
    : { ...state, open: true, autoLand: true };
  emit();
}

export function closeSettings(): void {
  if (!state.open) return;
  state = { ...state, open: false, autoLand: false };
  emit();
}

export function setSettingsSection(section: SectionId): void {
  if (state.open && state.section === section && !state.autoLand) return;
  state = { open: state.open, section, autoLand: false };
  emit();
}

/** Clear the auto-land intent once the modal has resolved its landing section. */
export function consumeAutoLand(): void {
  if (!state.autoLand) return;
  state = { ...state, autoLand: false };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SettingsState {
  return state;
}

export function useSettingsStore(): SettingsState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
