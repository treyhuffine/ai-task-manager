/**
 * Base styles for the included-app UI kit. Every class is prefixed `ri-` so
 * app CSS cannot collide with it. Tokens match the neutral Finances palette:
 * white, gray and charcoal in light and dark, with color reserved for a real
 * warning, failure or completed state and always paired with text or shape.
 *
 * Layout responds to the app container, not the viewport: `.ri-app` is an
 * inline-size container with breakpoints at 700 px (narrow below) and 1150 px
 * (wide from). Sizes use rem so text zoom grows spacing with the text.
 */

const tokens = `
:root {
  color-scheme: light;
  --ri-bg: #fafafa;
  --ri-surface: #fff;
  --ri-soft: #f3f3f3;
  --ri-text: #202020;
  --ri-muted: #6b6b6b;
  --ri-border: #e5e5e5;
  --ri-border-strong: #c9c9c9;
  --ri-selected: #ededed;
  --ri-button: #242424;
  --ri-on-button: #fff;
  --ri-danger: #a8443b;
  --ri-danger-bg: #faeeec;
  --ri-warn: #845412;
  --ri-warn-bg: #faf2df;
  --ri-positive: #18794e;
  --ri-positive-bg: #e8f3ed;
  --ri-shadow: 0 1rem 3.5rem #0000001f, 0 0.125rem 0.5rem #00000014;
  --ri-backdrop: #00000052;
  --ri-skeleton: #ececec;
  --ri-font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --ri-bg: #151515;
  --ri-surface: #1d1d1d;
  --ri-soft: #262626;
  --ri-text: #ededed;
  --ri-muted: #a8a8a8;
  --ri-border: #353535;
  --ri-border-strong: #4d4d4d;
  --ri-selected: #303030;
  --ri-button: #ededed;
  --ri-on-button: #1d1d1d;
  --ri-danger: #eda59c;
  --ri-danger-bg: #3a2522;
  --ri-warn: #e5bb7c;
  --ri-warn-bg: #3c3422;
  --ri-positive: #7cc7a1;
  --ri-positive-bg: #1d3328;
  --ri-shadow: 0 1rem 3.5rem #00000080, 0 0.125rem 0.5rem #0000004d;
  --ri-backdrop: #0000008c;
  --ri-skeleton: #2a2a2a;
}
html { background: var(--ri-bg); color: var(--ri-text); -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body { margin: 0; background: var(--ri-bg); }
`;

const base = `
.ri-app {
  container: ri-app / inline-size;
  min-width: 0;
  background: var(--ri-bg);
  color: var(--ri-text);
  font-family: var(--ri-font);
  font-size: 0.875rem;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.ri-app *, .ri-app *::before, .ri-app *::after, .ri-dialog, .ri-dialog *, .ri-dialog *::before, .ri-dialog *::after { box-sizing: border-box; }
.ri-app :where(h1, h2, h3, h4, p, dl, dd, ol, ul, figure, blockquote), .ri-dialog :where(h1, h2, h3, h4, p, dl, dd, ol, ul, figure, blockquote) { margin: 0; }
.ri-app :where(ol, ul), .ri-dialog :where(ol, ul) { padding: 0; list-style: none; }
.ri-app :where(button, input, select, textarea), .ri-dialog :where(button, input, select, textarea) { font: inherit; color: inherit; letter-spacing: inherit; }
.ri-app :where(button), .ri-dialog :where(button) { cursor: pointer; }
.ri-app :where(h1, h2, h3, h4, p, dd, td, th, li, label, legend, span, strong), .ri-dialog :where(h1, h2, h3, h4, p, dd, td, th, li, label, legend, span, strong) { overflow-wrap: break-word; }
.ri-app :where(a), .ri-dialog :where(a) { color: inherit; text-underline-offset: 0.2em; }
.ri-app :where(button, a, input, select, textarea, summary, [tabindex]):focus-visible,
.ri-dialog :where(button, a, input, select, textarea, summary, [tabindex]):focus-visible,
.ri-focusable:focus-visible {
  outline: 2px solid var(--ri-text);
  outline-offset: 2px;
}
.ri-app :where(svg), .ri-dialog :where(svg) { flex-shrink: 0; }
.ri-sr-only {
  position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important;
  overflow: hidden !important; clip: rect(0 0 0 0) !important; clip-path: inset(50%) !important; white-space: nowrap !important; border: 0 !important;
}
.ri-muted { color: var(--ri-muted); }
.ri-small { font-size: 0.75rem; line-height: 1.5; }
.ri-eyebrow { display: block; font-size: 0.6875rem; font-weight: 650; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ri-muted); }
.ri-h2 { font-size: 1.25rem; line-height: 1.3; font-weight: 600; letter-spacing: -0.02em; }
.ri-h3 { font-size: 0.9375rem; line-height: 1.4; font-weight: 600; letter-spacing: -0.005em; }
.ri-stack { display: grid; gap: 1rem; min-width: 0; }
.ri-stack--tight { gap: 0.5rem; }
.ri-stack--loose { gap: 1.5rem; }
.ri-card { background: var(--ri-surface); border: 1px solid var(--ri-border); border-radius: 0.75rem; padding: 1.25rem 1.5rem; min-width: 0; }
.ri-section-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.25rem 1rem; }
.ri-section-heading > p { font-size: 0.75rem; color: var(--ri-muted); }
`;

const shell = `
.ri-shell { max-width: 82.5rem; margin: 0 auto; padding: 2.25rem 2.5rem 4rem; min-width: 0; }
.ri-shell__header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem 1.5rem; margin-bottom: 1.5rem; }
.ri-shell__heading { min-width: min(100%, 16rem); flex: 1 1 22rem; }
.ri-shell__heading .ri-eyebrow { margin-bottom: 0.5rem; }
.ri-title { font-size: 1.8125rem; line-height: 1.2; font-weight: 620; letter-spacing: -0.035em; }
.ri-context { margin-top: 0.5rem; color: var(--ri-muted); font-size: 0.8125rem; }
.ri-shell__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.ri-shell__tabs { margin-bottom: 1.5rem; }
.ri-shell__notice { margin-bottom: 1.5rem; }
.ri-shell__body { min-width: 0; }
@container ri-app (max-width: 1149.98px) {
  .ri-shell { padding: 1.75rem 1.5rem 3rem; }
}
@container ri-app (max-width: 699.98px) {
  .ri-shell { padding: 1.25rem 1rem 2.5rem; }
  .ri-title { font-size: 1.6875rem; }
  .ri-shell__header { gap: 1rem; margin-bottom: 1.25rem; }
  .ri-shell__heading { flex-basis: 100%; }
  .ri-shell__tabs { margin-bottom: 1.25rem; }
  .ri-shell__notice { margin-bottom: 1.25rem; }
}
`;

const buttons = `
.ri-button {
  justify-self: start; display: inline-flex; align-items: center; justify-content: center; gap: 0.4375rem;
  min-height: 2.25rem; padding: 0.4375rem 0.875rem; border-radius: 0.5625rem;
  border: 1px solid var(--ri-border); background: var(--ri-surface); color: var(--ri-text);
  font-size: 0.8125rem; font-weight: 550; line-height: 1.3; text-align: center; text-decoration: none;
  transition: background-color 0.15s, border-color 0.15s, opacity 0.15s;
}
.ri-button:hover:not([aria-disabled="true"]):not(:disabled) { background: var(--ri-soft); }
.ri-button--primary { background: var(--ri-button); border-color: var(--ri-button); color: var(--ri-on-button); }
.ri-button--primary:hover:not([aria-disabled="true"]):not(:disabled) { background: var(--ri-button); opacity: 0.88; }
.ri-button--quiet { border-color: transparent; background: transparent; }
.ri-button--quiet:hover:not([aria-disabled="true"]):not(:disabled) { background: var(--ri-soft); }
.ri-button--danger { color: var(--ri-danger); }
.ri-button--danger-solid { background: var(--ri-danger); border-color: var(--ri-danger); color: var(--ri-surface); }
.ri-button--danger-solid:hover:not([aria-disabled="true"]):not(:disabled) { background: var(--ri-danger); opacity: 0.88; }
.ri-button--link {
  min-height: 0; padding: 0.125rem 0; border: 0; border-radius: 0.25rem; background: transparent;
  text-decoration: underline; text-underline-offset: 0.2em; text-decoration-thickness: 1px; text-align: left;
}
.ri-button--link:hover:not([aria-disabled="true"]):not(:disabled) { background: transparent; text-decoration-thickness: 2px; }
.ri-button--sm { min-height: 1.875rem; padding: 0.25rem 0.625rem; font-size: 0.75rem; border-radius: 0.5rem; }
.ri-button--lg { min-height: 2.625rem; padding: 0.5625rem 1.125rem; font-size: 0.875rem; }
.ri-button--link.ri-button--sm, .ri-button--link.ri-button--lg { min-height: 0; padding: 0.125rem 0; border-radius: 0.25rem; }
.ri-button--block { width: 100%; }
.ri-button:disabled, .ri-button[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
.ri-button[aria-busy="true"] { opacity: 1; cursor: progress; }
.ri-button__spinner {
  width: 0.875em; height: 0.875em; border-radius: 50%;
  border: 2px solid currentColor; border-right-color: transparent; animation: ri-spin 0.8s linear infinite;
}
.ri-button-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; min-width: 0; }
.ri-button-row--end { justify-content: flex-end; }
.ri-button-row--between { justify-content: space-between; }
@keyframes ri-spin { to { transform: rotate(360deg); } }
@media (pointer: coarse) {
  .ri-button:not(.ri-button--link) { min-height: 2.75rem; }
}
@container ri-app (max-width: 699.98px) {
  .ri-button:not(.ri-button--link):not(.ri-button--sm) { min-height: 2.5rem; }
}
`;

const navigation = `
.ri-tabs { position: relative; min-width: 0; border-bottom: 1px solid var(--ri-border); }
.ri-tabs__list { display: flex; gap: 1.5rem; overflow-x: auto; scrollbar-width: none; scroll-padding-inline: 2rem; padding: 0 0.125rem; margin: 0 -0.125rem; }
.ri-tabs__list::-webkit-scrollbar { display: none; }
.ri-tabs[data-overflow-end="true"] .ri-tabs__list { mask-image: linear-gradient(to right, #000 calc(100% - 2.5rem), transparent); }
.ri-tabs[data-overflow-start="true"] .ri-tabs__list { mask-image: linear-gradient(to left, #000 calc(100% - 2.5rem), transparent); }
.ri-tabs[data-overflow-start="true"][data-overflow-end="true"] .ri-tabs__list { mask-image: linear-gradient(to right, transparent, #000 2.5rem, #000 calc(100% - 2.5rem), transparent); }
.ri-tab {
  display: inline-flex; align-items: center; gap: 0.4375rem; flex-shrink: 0; white-space: nowrap;
  padding: 0.75rem 0.125rem 0.8125rem; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px;
  background: transparent; color: var(--ri-muted); font-size: 0.875rem; border-radius: 0.25rem 0.25rem 0 0;
}
.ri-tab:hover { color: var(--ri-text); }
.ri-tab[aria-selected="true"] { color: var(--ri-text); border-bottom-color: var(--ri-text); font-weight: 600; }
.ri-tab:focus-visible { outline-offset: -2px; }
.ri-tab__badge {
  min-width: 1.25rem; padding: 0 0.375rem; border-radius: 999px; background: var(--ri-selected); color: var(--ri-text);
  font-size: 0.6875rem; font-weight: 600; line-height: 1.25rem; text-align: center;
}
.ri-tabs__scroll {
  position: absolute; top: 0; bottom: 1px; display: none; align-items: center; justify-content: center;
  width: 1.75rem; border: 0; padding: 0; background: var(--ri-bg); color: var(--ri-text); border-radius: 0.375rem;
}
.ri-tabs__scroll--start { left: 0; }
.ri-tabs__scroll--end { right: 0; }
.ri-tabs[data-overflow-start="true"] .ri-tabs__scroll--start, .ri-tabs[data-overflow-end="true"] .ri-tabs__scroll--end { display: inline-flex; }
@container ri-app (max-width: 699.98px) {
  .ri-tabs__list { gap: 1.125rem; }
}
.ri-toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.75rem; min-width: 0; }
.ri-toolbar__end { margin-left: auto; display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.75rem; min-width: 0; }
@container ri-app (max-width: 699.98px) {
  .ri-toolbar__end { margin-left: 0; width: 100%; }
  .ri-toolbar__end > .ri-search { flex: 1 1 100%; }
}
.ri-search { display: grid; gap: 0.3125rem; min-width: min(100%, 13.75rem); }
.ri-search__label { font-size: 0.75rem; color: var(--ri-muted); }
.ri-search__box {
  display: flex; align-items: center; gap: 0.5rem; min-height: 2.25rem; padding: 0 0.75rem;
  border: 1px solid var(--ri-border); border-radius: 0.5625rem; background: var(--ri-surface); color: var(--ri-muted);
}
.ri-search__box:focus-within { border-color: var(--ri-text); }
.ri-search__box input { flex: 1; min-width: 0; padding: 0.4375rem 0; border: 0; background: transparent; color: var(--ri-text); outline: none; }
.ri-search__box input::-webkit-search-cancel-button { cursor: pointer; }
.ri-segmented { justify-self: start; display: inline-flex; flex-wrap: wrap; gap: 0.125rem; padding: 0.1875rem; border: 1px solid var(--ri-border); border-radius: 0.5625rem; background: var(--ri-surface); max-width: 100%; }
.ri-segmented__option {
  min-height: 1.75rem; padding: 0.1875rem 0.75rem; border: 0; border-radius: 0.375rem; background: transparent;
  color: var(--ri-muted); font-size: 0.8125rem;
}
.ri-segmented__option:hover { color: var(--ri-text); }
.ri-segmented__option[aria-checked="true"] { background: var(--ri-selected); color: var(--ri-text); font-weight: 550; }
.ri-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; min-width: 0; }
.ri-chip {
  display: inline-flex; align-items: center; gap: 0.375rem; min-height: 1.875rem; padding: 0.1875rem 0.75rem;
  border: 1px solid var(--ri-border); border-radius: 999px; background: var(--ri-surface); color: var(--ri-text); font-size: 0.8125rem;
}
.ri-chip:hover { background: var(--ri-soft); }
.ri-chip[aria-pressed="true"] { background: var(--ri-button); border-color: var(--ri-button); color: var(--ri-on-button); }
.ri-chip__count { color: inherit; opacity: 0.72; font-size: 0.75rem; }
.ri-chip__check { display: none; }
.ri-chip[aria-pressed="true"] .ri-chip__check { display: inline-block; }
.ri-day-rail { display: flex; flex-wrap: wrap; gap: 0.5rem; }
`;

const feedback = `
.ri-status {
  justify-self: start; display: inline-flex; align-items: center; gap: 0.375rem; max-width: 100%;
  padding: 0.125rem 0.5rem; border: 1px solid var(--ri-border); border-radius: 0.375rem;
  background: var(--ri-surface); color: var(--ri-text); font-size: 0.75rem; line-height: 1.45; font-weight: 500; vertical-align: middle;
}
.ri-status__marker { width: 0.6875rem; height: 0.6875rem; color: var(--ri-muted); }
.ri-status--warning { background: var(--ri-warn-bg); border-color: transparent; }
.ri-status--warning .ri-status__marker { color: var(--ri-warn); }
.ri-status--danger { background: var(--ri-danger-bg); border-color: transparent; }
.ri-status--danger .ri-status__marker { color: var(--ri-danger); }
.ri-status--success .ri-status__marker { color: var(--ri-positive); }
.ri-status--info .ri-status__marker { color: var(--ri-text); }
.ri-notice {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem 1rem;
  padding: 0.875rem 1rem 0.875rem 1.125rem; border: 1px solid var(--ri-border); border-left: 3px solid var(--ri-border-strong);
  border-radius: 0.625rem; background: var(--ri-surface); min-width: 0;
}
.ri-notice__content { display: flex; gap: 0.625rem; align-items: flex-start; flex: 1 1 16rem; min-width: 0; }
.ri-notice__marker { width: 1rem; height: 1rem; margin-top: 0.125rem; color: var(--ri-muted); }
.ri-notice__title { font-weight: 600; }
.ri-notice__body { color: var(--ri-muted); }
.ri-notice__body:not(:first-child) { margin-top: 0.125rem; }
.ri-notice--warning { border-left-color: var(--ri-warn); }
.ri-notice--warning .ri-notice__marker { color: var(--ri-warn); }
.ri-notice--danger { border-left-color: var(--ri-danger); }
.ri-notice--danger .ri-notice__marker { color: var(--ri-danger); }
.ri-notice--success { border-left-color: var(--ri-positive); }
.ri-notice--success .ri-notice__marker { color: var(--ri-positive); }
.ri-notice--info { border-left-color: var(--ri-text); }
.ri-notice--info .ri-notice__marker { color: var(--ri-text); }
.ri-empty { max-width: 34rem; margin: 3rem auto; padding: 0 1rem; text-align: center; display: grid; justify-items: center; gap: 0.75rem; }
.ri-empty__title { font-size: 1.375rem; line-height: 1.3; font-weight: 600; letter-spacing: -0.02em; }
.ri-empty__body { color: var(--ri-muted); max-width: 30rem; }
.ri-empty__actions { margin-top: 0.75rem; display: flex; flex-wrap: wrap; justify-content: center; gap: 0.5rem; }
.ri-empty--compact { margin: 1.5rem auto; }
.ri-empty--compact .ri-empty__title { font-size: 1rem; }
.ri-loading { display: grid; gap: 0.75rem; min-width: 0; }
.ri-loading__label { font-size: 0.75rem; color: var(--ri-muted); }
.ri-skeleton { display: grid; gap: 0.5rem; padding: 1rem 0; border-bottom: 1px solid var(--ri-border); }
.ri-skeleton__line { height: 0.75rem; border-radius: 0.25rem; background: var(--ri-skeleton); animation: ri-pulse 1.6s ease-in-out infinite; }
.ri-skeleton__line:nth-child(1) { width: 38%; height: 0.875rem; }
.ri-skeleton__line:nth-child(2) { width: 72%; }
.ri-skeleton__line:nth-child(3) { width: 54%; }
@keyframes ri-pulse { 50% { opacity: 0.55; } }
.ri-error {
  display: grid; gap: 0.75rem; justify-items: start; padding: 1rem 1.125rem;
  border: 1px solid var(--ri-border); border-left: 3px solid var(--ri-danger); border-radius: 0.625rem; background: var(--ri-surface);
}
.ri-error__message { display: flex; gap: 0.625rem; align-items: flex-start; }
.ri-error__marker { width: 1rem; height: 1rem; margin-top: 0.125rem; color: var(--ri-danger); }
.ri-inline-error { display: flex; gap: 0.5rem; align-items: flex-start; color: var(--ri-danger); font-size: 0.8125rem; }
.ri-inline-error svg { width: 0.875rem; height: 0.875rem; margin-top: 0.1875rem; }
.ri-toast-region { position: fixed; z-index: 50; left: 50%; bottom: 1.25rem; transform: translateX(-50%); max-width: calc(100% - 2rem); pointer-events: none; }
.ri-toast {
  display: flex; align-items: center; gap: 0.5rem; padding: 0.625rem 1rem; border-radius: 0.625rem;
  background: var(--ri-button); color: var(--ri-on-button); box-shadow: var(--ri-shadow); font-size: 0.8125rem; font-family: var(--ri-font);
}
`;

const content = `
.ri-kv { display: grid; gap: 0.625rem; min-width: 0; max-width: 40rem; }
.ri-kv__row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0.125rem 1rem; min-width: 0; }
.ri-kv__row dt { color: var(--ri-muted); font-size: 0.75rem; }
.ri-kv__row dd { margin: 0; font-size: 0.8125rem; text-align: right; min-width: 0; margin-left: auto; }
.ri-kv--stacked .ri-kv__row { display: grid; gap: 0.125rem; }
.ri-kv--stacked .ri-kv__row dd { text-align: left; margin-left: 0; }
.ri-table-wrap { min-width: 0; max-width: 100%; overflow-x: auto; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); }
.ri-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.8125rem; }
.ri-table caption { text-align: left; padding: 0.875rem 1rem 0.25rem; font-weight: 600; font-size: 0.875rem; }
.ri-table thead th { color: var(--ri-muted); font-weight: 500; font-size: 0.75rem; white-space: nowrap; }
.ri-table tbody th { font-weight: 550; color: var(--ri-text); }
.ri-table th, .ri-table td { padding: 0.75rem 1rem; border-bottom: 1px solid var(--ri-border); vertical-align: top; }
.ri-table tbody tr:last-child > * { border-bottom: 0; }
.ri-table [data-align="end"] { text-align: right; font-variant-numeric: tabular-nums; }
.ri-table__sort { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0; border: 0; background: transparent; color: inherit; font-weight: inherit; border-radius: 0.25rem; }
.ri-table__sort svg { width: 0.625rem; height: 0.625rem; }
.ri-table tbody tr[data-selectable="true"] { cursor: pointer; }
.ri-table tbody tr[data-selectable="true"]:hover { background: var(--ri-soft); }
.ri-table tbody tr[aria-current="true"] { background: var(--ri-selected); }
.ri-table tbody tr[aria-current="true"] > :first-child { box-shadow: inset 3px 0 0 var(--ri-text); }
.ri-table tbody tr:focus-visible { outline: 2px solid var(--ri-text); outline-offset: -2px; }
.ri-table--sticky tr > :first-child { position: sticky; left: 0; z-index: 1; background: var(--ri-surface); }
.ri-table--sticky tbody tr[data-selectable="true"]:hover > :first-child { background: var(--ri-soft); }
.ri-table--sticky tbody tr[aria-current="true"] > :first-child { background: var(--ri-selected); }
.ri-table__primary { font-weight: 550; }
.ri-table-empty { padding: 1.25rem 1rem; color: var(--ri-muted); }
.ri-row-cards { display: grid; gap: 0.5rem; min-width: 0; }
.ri-row-cards__caption { font-weight: 600; margin-bottom: 0.25rem; }
.ri-row-card {
  display: grid; gap: 0.375rem; width: 100%; min-width: 0; padding: 0.875rem 1rem; text-align: left;
  border: 1px solid var(--ri-border); border-radius: 0.625rem; background: var(--ri-surface); color: var(--ri-text);
}
button.ri-row-card:hover { background: var(--ri-soft); }
.ri-row-card[aria-current="true"] { border-color: var(--ri-text); box-shadow: inset 0 0 0 1px var(--ri-text); }
.ri-row-card__title { display: block; font-weight: 600; }
.ri-row-card__field { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.125rem 0.75rem; font-size: 0.8125rem; }
.ri-row-card__label { color: var(--ri-muted); font-size: 0.75rem; }
.ri-row-card__value { text-align: right; margin-left: auto; min-width: 0; }
.ri-timeline { container: ri-timeline / inline-size; display: grid; min-width: 0; }
.ri-timeline__item { position: relative; display: grid; grid-template-columns: 4.25rem 0.875rem minmax(0, 1fr); column-gap: 0.75rem; padding-bottom: 1.25rem; }
.ri-timeline__item::after { content: ""; position: absolute; left: calc(4.25rem + 0.75rem + 0.4375rem); top: 1.375rem; bottom: 0; width: 1px; background: var(--ri-border); }
.ri-timeline__item:last-child::after { display: none; }
.ri-timeline__date { padding-top: 0.0625rem; font-size: 0.8125rem; font-variant-numeric: tabular-nums; color: var(--ri-text); }
.ri-timeline__marker { width: 0.5625rem; height: 0.5625rem; margin: 0.4375rem auto 0; border: 1px solid var(--ri-muted); border-radius: 50%; background: var(--ri-bg); position: relative; z-index: 1; }
.ri-timeline__item[data-tone="warning"] .ri-timeline__marker { border-color: var(--ri-warn); background: var(--ri-warn); border-radius: 1px; transform: rotate(45deg); }
.ri-timeline__item[data-tone="danger"] .ri-timeline__marker { border-color: var(--ri-danger); background: var(--ri-danger); border-radius: 1px; }
.ri-timeline__item[data-tone="success"] .ri-timeline__marker { border-color: var(--ri-positive); background: var(--ri-positive); }
.ri-timeline__content { display: grid; gap: 0.25rem; min-width: 0; }
.ri-timeline--cards .ri-timeline__content { padding: 0.75rem 1rem; border: 1px solid var(--ri-border); border-radius: 0.625rem; background: var(--ri-surface); }
.ri-timeline--cards .ri-timeline__item[data-selected="true"] .ri-timeline__content { border-color: var(--ri-text); box-shadow: inset 0 0 0 1px var(--ri-text); }
.ri-timeline__item[data-selected="true"] .ri-timeline__marker { background: var(--ri-text); border-color: var(--ri-text); }
.ri-timeline__title { font-weight: 600; }
.ri-timeline__select { display: block; width: 100%; padding: 0; border: 0; background: transparent; text-align: left; font-weight: 600; border-radius: 0.25rem; }
.ri-timeline__select:hover { text-decoration: underline; text-underline-offset: 0.2em; }
.ri-timeline__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.625rem; font-size: 0.75rem; color: var(--ri-muted); }
.ri-timeline__body { line-height: 1.55; }
.ri-timeline__excerpt { margin-top: 0.25rem; padding: 0.625rem 0.875rem; border-left: 2px solid var(--ri-border-strong); background: var(--ri-soft); border-radius: 0 0.5rem 0.5rem 0; font-size: 0.8125rem; white-space: pre-wrap; color: var(--ri-text); }
.ri-timeline__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 1rem; margin-top: 0.125rem; }
@container ri-timeline (max-width: 31.25rem) {
  .ri-timeline__item { grid-template-columns: 0.875rem minmax(0, 1fr); column-gap: 0.625rem; }
  .ri-timeline__item::after { left: 0.4375rem; }
  .ri-timeline__date { grid-column: 2; grid-row: 1; padding: 0 0 0.125rem; font-size: 0.75rem; color: var(--ri-muted); }
  .ri-timeline__marker { grid-column: 1; grid-row: 1; margin-top: 0.3125rem; }
  .ri-timeline__content { grid-column: 2; }
}
.ri-source { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.125rem 0.75rem; font-size: 0.75rem; line-height: 1.5; color: var(--ri-muted); min-width: 0; }
.ri-source__marker { display: inline-block; width: 0.75rem; height: 0.75rem; margin-right: 0.375rem; vertical-align: -0.125rem; }
.ri-source__text { flex: 0 1 auto; min-width: 0; }
.ri-source__sep { white-space: pre; }
.ri-source .ri-button--link { color: var(--ri-text); font-size: 0.75rem; }
.ri-source--unavailable .ri-source__state { color: var(--ri-text); font-weight: 550; }
.ri-avatar {
  display: inline-grid; place-items: center; flex-shrink: 0; width: 2.5rem; height: 2.5rem; border-radius: 50%;
  background: var(--ri-selected); color: var(--ri-text); font-weight: 550; font-size: 0.875rem; line-height: 1; user-select: none;
}
.ri-avatar-label { display: inline-flex; align-items: center; gap: 0.625rem; min-width: 0; max-width: 100%; }
.ri-avatar-label__text { display: grid; min-width: 0; }
.ri-avatar-label__name { font-weight: 550; overflow-wrap: anywhere; }
.ri-avatar-label__detail { font-size: 0.75rem; color: var(--ri-muted); font-weight: 400; }
.ri-avatar--sm { width: 1.75rem; height: 1.75rem; font-size: 0.6875rem; }
.ri-avatar--lg { width: 3.5rem; height: 3.5rem; font-size: 1.125rem; }
`;

const layout = `
.ri-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.75rem; min-width: 0; align-items: start; }
.ri-split[data-mode="split"][data-detail="true"] { grid-template-columns: minmax(0, 2fr) minmax(18rem, 1fr); }
.ri-split__pane { min-width: 0; }
.ri-split__detail { min-width: 0; }
/* Regions that take focus only so assistive technology lands in the right place. */
.ri-app .ri-split__detail:focus-visible, .ri-app [role="tabpanel"]:focus-visible { outline: none; }
.ri-split[data-mode="split"] .ri-split__detail { position: sticky; top: 1rem; }
.ri-split__back { margin-bottom: 1rem; margin-left: -0.5rem; color: var(--ri-muted); }
.ri-split__back:hover { color: var(--ri-text); }
.ri-inspector { display: grid; gap: 1.125rem; min-width: 0; padding: 1.375rem 1.5rem 1.5rem; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); }
.ri-split[data-mode="single"] .ri-inspector { padding: 0; border: 0; background: transparent; }
.ri-inspector__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
.ri-inspector__heading { display: grid; gap: 0.375rem; min-width: 0; }
.ri-inspector__title { font-size: 1.25rem; line-height: 1.3; font-weight: 600; letter-spacing: -0.02em; }
.ri-inspector__subtitle { color: var(--ri-muted); font-size: 0.8125rem; }
.ri-inspector__body { display: grid; gap: 1.125rem; min-width: 0; }
.ri-inspector__body > hr, .ri-divider { width: 100%; height: 1px; margin: 0; border: 0; background: var(--ri-border); }
.ri-inspector__actions { display: flex; flex-wrap: wrap; gap: 0.5rem; padding-top: 1rem; border-top: 1px solid var(--ri-border); }
.ri-icon-button {
  display: inline-flex; align-items: center; justify-content: center; width: 2rem; height: 2rem; padding: 0;
  border: 0; border-radius: 0.5rem; background: transparent; color: var(--ri-muted);
}
.ri-icon-button:hover { background: var(--ri-soft); color: var(--ri-text); }
.ri-icon-button svg { width: 1rem; height: 1rem; }
@media (pointer: coarse) { .ri-icon-button { width: 2.75rem; height: 2.75rem; } }
`;

const menu = `
.ri-menu { position: relative; justify-self: start; display: inline-flex; max-width: 100%; }
.ri-menu__chevron { width: 0.75rem; height: 0.75rem; }
.ri-menu__popup {
  position: absolute; z-index: 30; top: calc(100% + 0.25rem); left: 0; min-width: 12rem; max-width: min(20rem, calc(100vw - 2rem));
  max-height: min(22rem, 70vh); overflow-y: auto; padding: 0.25rem; border: 1px solid var(--ri-border); border-radius: 0.625rem;
  background: var(--ri-surface); box-shadow: var(--ri-shadow);
}
.ri-menu__popup[data-align="end"] { left: auto; right: 0; }
.ri-menu__popup[data-side="top"] { top: auto; bottom: calc(100% + 0.25rem); }
.ri-menu__item {
  display: flex; align-items: center; gap: 0.5rem; width: 100%; min-height: 2.125rem; padding: 0.375rem 0.625rem;
  border: 0; border-radius: 0.4375rem; background: transparent; color: var(--ri-text); text-align: left; font-size: 0.8125rem;
}
.ri-menu__item:hover, .ri-menu__item:focus-visible { background: var(--ri-selected); outline: none; }
.ri-menu__item:focus-visible { box-shadow: inset 0 0 0 2px var(--ri-text); }
.ri-menu__item[aria-disabled="true"] { color: var(--ri-muted); cursor: not-allowed; }
.ri-menu__check { width: 0.875rem; height: 0.875rem; visibility: hidden; }
.ri-menu__item[aria-checked="true"] .ri-menu__check { visibility: visible; }
.ri-menu__hint { margin-left: auto; color: var(--ri-muted); font-size: 0.75rem; }
`;

const dialog = `
.ri-dialog {
  width: min(35rem, calc(100% - 2rem)); max-width: none; max-height: min(90dvh, 52rem); padding: 0; margin: auto;
  border: 1px solid var(--ri-border); border-radius: 1rem; background: var(--ri-surface); color: var(--ri-text);
  box-shadow: var(--ri-shadow); font-family: var(--ri-font); font-size: 0.875rem; line-height: 1.5; overflow: hidden;
}
.ri-dialog[open] { display: flex; flex-direction: column; }
.ri-dialog--wide { width: min(45rem, calc(100% - 2rem)); }
.ri-dialog::backdrop { background: var(--ri-backdrop); }
.ri-dialog__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; padding: 1.125rem 1.5rem 1rem; border-bottom: 1px solid var(--ri-border); }
.ri-dialog__title { font-size: 1.125rem; line-height: 1.35; font-weight: 600; letter-spacing: -0.015em; }
.ri-dialog__description { margin-top: 0.25rem; color: var(--ri-muted); font-size: 0.8125rem; }
.ri-dialog__body { display: grid; gap: 1.125rem; align-content: start; padding: 1.25rem 1.5rem; overflow-y: auto; min-height: 0; flex: 1 1 auto; overscroll-behavior: contain; }
.ri-dialog__foot { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; padding: 1rem 1.5rem; border-top: 1px solid var(--ri-border); background: var(--ri-surface); }
.ri-dialog--full { width: 100%; height: 100%; max-height: 100%; border-radius: 0; border: 0; }
@media (max-width: 699.98px) {
  .ri-dialog { width: 100%; height: 100%; max-height: 100%; border-radius: 0; border: 0; }
  .ri-dialog__head, .ri-dialog__body, .ri-dialog__foot { padding-left: 1rem; padding-right: 1rem; }
  .ri-dialog__foot > .ri-button { flex: 1 1 auto; }
}
`;

const forms = `
.ri-field { display: grid; gap: 0.375rem; align-content: start; min-width: 0; border: 0; padding: 0; margin: 0; }
.ri-field__label { font-size: 0.8125rem; font-weight: 550; color: var(--ri-text); padding: 0; }
.ri-field__required { color: var(--ri-muted); font-weight: 400; margin-left: 0.25rem; font-size: 0.75rem; }
.ri-field__hint { font-size: 0.75rem; color: var(--ri-muted); }
.ri-field__error { display: flex; gap: 0.375rem; align-items: flex-start; font-size: 0.75rem; color: var(--ri-danger); }
.ri-field__error svg { width: 0.75rem; height: 0.75rem; margin-top: 0.1875rem; }
.ri-input, .ri-textarea, .ri-select {
  width: 100%; min-width: 0; min-height: 2.375rem; padding: 0.5rem 0.75rem; border: 1px solid var(--ri-border); border-radius: 0.5625rem;
  background: var(--ri-surface); color: var(--ri-text); font-size: 0.875rem; line-height: 1.4;
}
.ri-input:hover, .ri-textarea:hover, .ri-select:hover { border-color: var(--ri-border-strong); }
.ri-app .ri-input:focus-visible, .ri-app .ri-textarea:focus-visible, .ri-app .ri-select:focus-visible,
.ri-dialog .ri-input:focus-visible, .ri-dialog .ri-textarea:focus-visible, .ri-dialog .ri-select:focus-visible { outline: 2px solid var(--ri-text); outline-offset: -1px; border-color: var(--ri-text); }
.ri-input[aria-invalid="true"], .ri-textarea[aria-invalid="true"], .ri-select[aria-invalid="true"] { border-color: var(--ri-danger); }
.ri-input::placeholder, .ri-textarea::placeholder { color: var(--ri-muted); opacity: 1; }
.ri-textarea { min-height: 6rem; resize: vertical; line-height: 1.55; }
.ri-select { padding-right: 2rem; cursor: pointer; }
.ri-check { display: flex; align-items: flex-start; gap: 0.625rem; min-width: 0; cursor: pointer; }
.ri-check input { width: 1rem; height: 1rem; margin: 0.15rem 0 0; flex-shrink: 0; accent-color: var(--ri-text); cursor: pointer; }
.ri-check__text { display: grid; gap: 0.125rem; min-width: 0; }
.ri-check__label { font-size: 0.875rem; }
.ri-check__hint { font-size: 0.75rem; color: var(--ri-muted); }
.ri-choice-list { display: grid; gap: 0.625rem; }
.ri-fieldset { display: grid; gap: 0.625rem; min-width: 0; margin: 0; padding: 0; border: 0; }
.ri-fieldset > legend { padding: 0; margin-bottom: 0.625rem; font-size: 0.8125rem; font-weight: 550; }
.ri-money { display: grid; grid-template-columns: minmax(0, 1fr) minmax(5.5rem, auto); gap: 0.5rem; }
.ri-form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: 1rem; align-items: start; }
@container ri-app (max-width: 699.98px) {
  .ri-input, .ri-textarea, .ri-select { font-size: 1rem; min-height: 2.625rem; }
}
@media (max-width: 699.98px) {
  .ri-dialog .ri-input, .ri-dialog .ri-textarea, .ri-dialog .ri-select { font-size: 1rem; min-height: 2.625rem; }
}
`;

const workflow = `
.ri-compare { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
.ri-compare th, .ri-compare td { padding: 0.625rem 0.75rem; border-bottom: 1px solid var(--ri-border); text-align: left; vertical-align: top; }
.ri-compare thead th { color: var(--ri-muted); font-weight: 500; font-size: 0.75rem; }
.ri-compare tbody th { font-weight: 500; color: var(--ri-muted); font-size: 0.75rem; width: 28%; }
.ri-compare tbody tr:last-child th, .ri-compare tbody tr:last-child td { border-bottom: 0; }
.ri-compare__changed { font-weight: 600; }
.ri-compare__marker { display: inline-block; margin-left: 0.375rem; font-size: 0.6875rem; font-weight: 500; color: var(--ri-muted); }
.ri-compare-wrap { container: ri-compare / inline-size; border: 1px solid var(--ri-border); border-radius: 0.625rem; overflow: hidden; background: var(--ri-surface); }
@container ri-compare (max-width: 30rem) {
  .ri-compare, .ri-compare tbody, .ri-compare tr { display: block; }
  .ri-compare thead { display: none; }
  .ri-compare tr { padding: 0.75rem; border-bottom: 1px solid var(--ri-border); }
  .ri-compare tbody tr:last-child { border-bottom: 0; }
  .ri-compare th, .ri-compare td { display: block; padding: 0.125rem 0; border: 0; width: auto; }
  .ri-compare tbody th { width: auto; margin-bottom: 0.25rem; }
  .ri-compare td::before { content: attr(data-label) ": "; color: var(--ri-muted); font-size: 0.75rem; }
}
.ri-review { display: grid; gap: 1rem; max-width: 50rem; }
.ri-review__head { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; justify-content: space-between; align-items: flex-start; }
.ri-review__reason { color: var(--ri-muted); margin-top: 0.25rem; }
.ri-conflict { display: grid; gap: 0.875rem; padding: 1.125rem 1.25rem; border: 1px solid var(--ri-border); border-left: 3px solid var(--ri-warn); border-radius: 0.75rem; background: var(--ri-surface); }
.ri-conflict__head { display: flex; gap: 0.625rem; align-items: flex-start; }
.ri-conflict__marker { width: 1rem; height: 1rem; margin-top: 0.1875rem; color: var(--ri-warn); }
.ri-followup__preview { display: grid; gap: 0.25rem; padding: 0.875rem 1rem; border: 1px solid var(--ri-border); border-radius: 0.625rem; background: var(--ri-soft); }
.ri-followup__preview strong { font-weight: 600; }
.ri-sources { display: grid; gap: 2rem; min-width: 0; }
.ri-sources__intro { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 1rem; }
.ri-sources__intro p { color: var(--ri-muted); margin-top: 0.375rem; max-width: 40rem; }
.ri-sources__group { display: grid; gap: 0.875rem; min-width: 0; }
.ri-account { display: grid; gap: 1rem; padding: 1.25rem 1.5rem; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); min-width: 0; }
.ri-account__head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 0.5rem 1rem; }
.ri-account__name { display: grid; gap: 0.125rem; min-width: 0; }
.ri-account__kind { font-size: 0.75rem; color: var(--ri-muted); }
.ri-account__facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 8.5rem), 1fr)); gap: 0.875rem 1.5rem; align-items: start; margin: 0; }
.ri-account__fact { display: grid; gap: 0.125rem; align-content: start; min-width: 0; }
.ri-account__fact dt { font-size: 0.75rem; color: var(--ri-muted); }
.ri-account__fact dd { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.5rem; }
.ri-account__error { display: flex; gap: 0.5rem; align-items: flex-start; padding: 0.625rem 0.75rem; border-radius: 0.5rem; background: var(--ri-danger-bg); font-size: 0.8125rem; }
.ri-account__error svg { width: 0.875rem; height: 0.875rem; margin-top: 0.1875rem; color: var(--ri-danger); }
.ri-account__actions { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.5rem 0.75rem; padding-top: 1rem; border-top: 1px solid var(--ri-border); }
.ri-account__actions .ri-field { min-width: 9.5rem; }
.ri-account__actions .ri-account__delete { margin-left: auto; }
@container ri-app (max-width: 699.98px) {
  .ri-account, .ri-card, .ri-inspector { padding: 1rem; }
  .ri-account__actions .ri-account__delete { margin-left: 0; }
}
.ri-explainer { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap: 1rem 1.5rem; margin: 0; padding: 1.125rem 1.25rem; border: 1px solid var(--ri-border); border-radius: 0.75rem; }
.ri-explainer dt { font-weight: 600; font-size: 0.8125rem; }
.ri-explainer dd { margin: 0.25rem 0 0; color: var(--ri-muted); font-size: 0.8125rem; }
.ri-share-list { display: grid; gap: 0; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); }
.ri-share { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.5rem 1rem; padding: 0.875rem 1.125rem; border-bottom: 1px solid var(--ri-border); }
.ri-share:last-child { border-bottom: 0; }
.ri-share__text { display: grid; gap: 0.125rem; min-width: 0; }
.ri-scope { display: grid; gap: 1.25rem; max-width: 40rem; }
.ri-scope__option { padding: 0.75rem 0.875rem; border: 1px solid var(--ri-border); border-radius: 0.625rem; background: var(--ri-surface); }
.ri-scope__option:has(input:checked) { border-color: var(--ri-text); }
.ri-scope__summary { padding: 0.75rem 0.875rem; border-radius: 0.625rem; background: var(--ri-soft); font-size: 0.8125rem; }
`;

const motion = `
@media (prefers-reduced-motion: reduce) {
  .ri-app *, .ri-app *::before, .ri-app *::after, .ri-dialog, .ri-dialog *, .ri-toast {
    animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important;
  }
  .ri-skeleton__line { animation: none !important; }
  .ri-button__spinner { animation: none !important; border-right-color: currentColor; opacity: 0.6; }
}
@media (forced-colors: active) {
  .ri-status, .ri-chip, .ri-tab[aria-selected="true"], .ri-segmented__option[aria-checked="true"] { border: 1px solid CanvasText; }
  .ri-table tbody tr[aria-current="true"], .ri-row-card[aria-current="true"] { outline: 2px solid Highlight; }
}
`;

/** The complete kit stylesheet. Inject with `installStyles()`. */
export const baseStyles: string = [tokens, base, shell, buttons, navigation, feedback, content, layout, menu, dialog, forms, workflow, motion]
  .join("\n")
  .replace(/\n\s+/g, "\n")
  .trim();

const STYLE_ID = "ri-ui-kit-styles";
const installedExtras = new Set<string>();

/**
 * Inject the kit stylesheet once as a single `<style>` element. The view CSP
 * allows inline styles. Extra CSS is appended to the same element once per
 * distinct string. Safe to call repeatedly and a no-op outside a browser.
 */
export function installStyles(extraCss?: string): HTMLStyleElement | null {
  if (typeof document === "undefined") return null;
  let element = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!element) {
    element = document.createElement("style");
    element.id = STYLE_ID;
    element.setAttribute("data-ri-ui", "");
    element.textContent = baseStyles;
    document.head.prepend(element);
  }
  if (extraCss && !installedExtras.has(extraCss)) {
    installedExtras.add(extraCss);
    element.textContent += "\n" + extraCss;
  }
  return element;
}
