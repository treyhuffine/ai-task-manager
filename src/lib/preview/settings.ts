/**
 * Global preview settings — how previews are reached, app-wide. Persisted
 * at `<app-root>/preview.json` (0600). Distinct from per-workspace preview
 * command/port (those live on the workspace row) and from the beamd
 * `{server, token}` (that lives in `beamd.yaml` for the CLI's `--config`).
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
  /** Active remote provider id: 'localhost' (local-only) | 'beamd' | 'portless' | 'manual' | <plugin>. */
  activeProvider: string;
  /** Manual default URL template, e.g. `https://{name}.mytunnel.com`. Used by
   *  ManualProvider when no explicit per-execution URL is set. */
  manualTemplate: string | null;
  /** Optional explicit path to the `beamd` binary (for local/unpublished builds). */
  beamdBinPath: string | null;
}

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  version: 1,
  activeProvider: 'localhost',
  manualTemplate: null,
  beamdBinPath: null,
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
      beamdBinPath: parsed.beamdBinPath ?? null,
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
    beamdBinPath: 'beamdBinPath' in patch ? (patch.beamdBinPath || null) : existing.beamdBinPath,
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
