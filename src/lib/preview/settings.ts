/**
 * Global preview settings — how previews are reached, app-wide. Persisted
 * at `<app-root>/preview.json` (0600). Distinct from per-workspace preview
 * command (lives on the workspace row) and from the beamd credential (which
 * Flow does NOT store — it lives in the machine's shared `~/.beamd/` account,
 * set up via `beamd login`; Flow is just another beamd client).
 *
 * One choice lives here that the whole picker turns on: the **active remote
 * provider** — what URL a preview resolves to when the viewer isn't on the
 * same machine as Flow.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ensureAppRoot, getAppRoot } from '@/lib/config/paths';

export interface PreviewSettings {
  version: 1;
  /** Active remote provider id: 'localhost' (local-only) | 'beamd' | 'manual' | <plugin>. */
  activeProvider: string;
  /** Manual default URL template, e.g. `https://{name}.mytunnel.com`. Used by
   *  ManualProvider when no explicit per-execution URL is set. */
  manualTemplate: string | null;
}

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  version: 1,
  activeProvider: 'localhost',
  manualTemplate: null,
};

function getPreviewSettingsPath(): string {
  return path.join(getAppRoot(), 'preview.json');
}

export function readPreviewSettings(): PreviewSettings {
  try {
    const raw = fs.readFileSync(getPreviewSettingsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PreviewSettings>;
    return {
      version: 1,
      activeProvider: parsed.activeProvider?.trim() || DEFAULT_PREVIEW_SETTINGS.activeProvider,
      manualTemplate: parsed.manualTemplate ?? null,
    };
  } catch {
    return { ...DEFAULT_PREVIEW_SETTINGS };
  }
}

export function writePreviewSettings(patch: Partial<PreviewSettings>): PreviewSettings {
  ensureAppRoot();
  const existing = readPreviewSettings();
  const next: PreviewSettings = {
    version: 1,
    activeProvider: patch.activeProvider?.trim() || existing.activeProvider,
    manualTemplate: 'manualTemplate' in patch ? (patch.manualTemplate || null) : existing.manualTemplate,
  };
  const p = getPreviewSettingsPath();
  fs.writeFileSync(p, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    // Best-effort.
  }
  return next;
}

/**
 * Render a manual URL template against a preview name. Supports `{name}`
 * (the DNS label) and `{port}`. Returns null for an empty template.
 */
export function renderManualTemplate(
  template: string | null,
  vars: { name: string; port?: number },
): string | null {
  if (!template || !template.trim()) return null;
  return template
    .replace(/\{name\}/g, vars.name)
    .replace(/\{port\}/g, vars.port != null ? String(vars.port) : '');
}
