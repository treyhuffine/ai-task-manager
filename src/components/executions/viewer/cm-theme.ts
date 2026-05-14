/**
 * Light + dark CodeMirror 6 themes wired up to the app's Tailwind
 * tokens. We don't use a full pre-built theme (Dracula, etc.) — those
 * fight the app's neutral aesthetic. Instead we compose minimal token
 * overrides on top of CodeMirror's default highlight specs.
 *
 * The dark and light variants use shared semantic colors that map to
 * CSS variables (`--background`, `--foreground`, …) where possible, so
 * a future theme rename only has to touch the design tokens.
 */

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12px',
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    lineHeight: '1.55',
  },
  '.cm-content': { padding: '10px 0' },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--muted-foreground, #888)',
    opacity: 0.55,
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-cursor': { borderLeftColor: 'currentColor' },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklab, currentColor 18%, transparent)',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklab, currentColor 22%, transparent)',
  },
});

// Light syntax palette — soft neutrals for backgrounds plus a tight set
// of accents for keywords, strings, numbers, comments. Chosen to remain
// legible on the muted off-white the app uses for surfaces.
const lightHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#7c3aed', fontWeight: '600' },
  { tag: t.controlKeyword, color: '#7c3aed', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: '#15803d' },
  { tag: t.number, color: '#b45309' },
  { tag: t.bool, color: '#b45309' },
  { tag: t.null, color: '#b45309' },
  { tag: t.atom, color: '#b45309' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#1d4ed8' },
  { tag: t.variableName, color: '#0f172a' },
  { tag: t.propertyName, color: '#0f172a' },
  { tag: t.className, color: '#0e7490', fontWeight: '600' },
  { tag: t.typeName, color: '#0e7490' },
  { tag: t.tagName, color: '#be185d' },
  { tag: t.attributeName, color: '#9333ea' },
  { tag: t.operator, color: '#475569' },
  { tag: t.punctuation, color: '#64748b' },
  { tag: t.comment, color: '#94a3b8', fontStyle: 'italic' },
  { tag: t.meta, color: '#94a3b8' },
  { tag: t.regexp, color: '#15803d' },
  { tag: t.heading, color: '#0f172a', fontWeight: '700' },
  { tag: t.link, color: '#1d4ed8', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
]);

// Dark syntax palette — pulls toward the cooler end of the spectrum to
// match the app's dark mode greys.
const darkHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#c084fc', fontWeight: '600' },
  { tag: t.controlKeyword, color: '#c084fc', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: '#86efac' },
  { tag: t.number, color: '#fbbf24' },
  { tag: t.bool, color: '#fbbf24' },
  { tag: t.null, color: '#fbbf24' },
  { tag: t.atom, color: '#fbbf24' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#93c5fd' },
  { tag: t.variableName, color: '#e2e8f0' },
  { tag: t.propertyName, color: '#e2e8f0' },
  { tag: t.className, color: '#67e8f9', fontWeight: '600' },
  { tag: t.typeName, color: '#67e8f9' },
  { tag: t.tagName, color: '#f0abfc' },
  { tag: t.attributeName, color: '#d8b4fe' },
  { tag: t.operator, color: '#cbd5e1' },
  { tag: t.punctuation, color: '#94a3b8' },
  { tag: t.comment, color: '#64748b', fontStyle: 'italic' },
  { tag: t.meta, color: '#64748b' },
  { tag: t.regexp, color: '#86efac' },
  { tag: t.heading, color: '#f1f5f9', fontWeight: '700' },
  { tag: t.link, color: '#93c5fd', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
]);

export function cmTheme(mode: 'light' | 'dark'): Extension {
  return [baseTheme, syntaxHighlighting(mode === 'dark' ? darkHighlight : lightHighlight)];
}
