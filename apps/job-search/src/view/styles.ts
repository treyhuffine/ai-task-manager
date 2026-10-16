/** Job Search styles on top of the kit. Neutral tokens only, prefixed js-. */
export const JOB_SEARCH_CSS = `
.js-strip { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem 1.5rem; padding: 1.125rem 1.375rem; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); }
.js-strip__text { display: grid; gap: 0.3125rem; min-width: min(100%, 16rem); flex: 1 1 18rem; }
.js-strip__title { font-size: 1rem; font-weight: 600; letter-spacing: -0.01em; }
.js-strip__meta { font-size: 0.75rem; color: var(--ri-muted); }
.js-board { display: grid; gap: 1rem; align-items: start; grid-template-columns: repeat(var(--js-columns, 4), minmax(0, 1fr)); }
.js-column { display: grid; gap: 0.625rem; min-width: 0; align-content: start; }
.js-column__head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; padding: 0 0.125rem 0.25rem; font-size: 0.8125rem; font-weight: 600; }
.js-column__count { font-weight: 500; color: var(--ri-muted); font-variant-numeric: tabular-nums; }
.js-column__empty { padding: 0.875rem; border: 1px dashed var(--ri-border); border-radius: 0.75rem; color: var(--ri-muted); font-size: 0.75rem; }
.js-card { display: grid; gap: 0.3125rem; width: 100%; padding: 0.875rem 1rem 0.9375rem; text-align: left; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); color: var(--ri-text); min-width: 0; }
.js-card:hover { border-color: var(--ri-border-strong); }
.js-card[aria-current="true"] { border-color: var(--ri-text); box-shadow: inset 0 0 0 1px var(--ri-text); }
.js-card__company { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8125rem; min-width: 0; }
.js-card__company > span:last-child { overflow-wrap: anywhere; }
.js-mark { display: inline-grid; place-items: center; flex: 0 0 auto; width: 1.375rem; height: 1.375rem; border-radius: 0.375rem; background: var(--ri-soft); font-size: 0.6875rem; font-weight: 650; }
.js-card__role { font-weight: 600; font-size: 0.875rem; line-height: 1.35; margin-top: 0.125rem; }
.js-card__place { font-size: 0.75rem; color: var(--ri-muted); }
.js-card__next { margin-top: 0.4375rem; padding-top: 0.5625rem; border-top: 1px solid var(--ri-border); font-size: 0.75rem; display: grid; gap: 0.1875rem; }
.js-card__note { color: var(--ri-muted); }
.js-card__flag { display: inline-flex; align-items: center; gap: 0.3125rem; font-size: 0.6875rem; color: var(--ri-muted); }
.js-sections { display: grid; gap: 1.25rem; }
.js-sections .js-column__head { font-size: 0.875rem; }
.js-grid-2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem); gap: 1.5rem; align-items: start; }
.js-panel { display: grid; gap: 0.875rem; padding: 1.125rem 1.25rem; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); min-width: 0; align-content: start; }
.js-panel--soft { background: var(--ri-soft); border-color: transparent; }
.js-panel__title { font-size: 0.9375rem; font-weight: 600; }
.js-list { display: grid; gap: 0.625rem; min-width: 0; }
.js-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; padding: 0.875rem 1rem; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); min-width: 0; }
.js-row__text { display: grid; gap: 0.1875rem; min-width: min(100%, 14rem); flex: 1 1 16rem; }
.js-row__title { font-weight: 600; }
.js-req { display: grid; gap: 0.25rem; padding: 0.625rem 0; border-bottom: 1px solid var(--ri-border); }
.js-req:last-child { border-bottom: 0; }
.js-quote { margin: 0; padding: 0.5rem 0.75rem; border-left: 2px solid var(--ri-border-strong); color: var(--ri-muted); font-size: 0.75rem; white-space: pre-wrap; }
.js-doc { margin: 0; padding: 1rem 1.125rem; border: 1px solid var(--ri-border); border-radius: 0.625rem; background: var(--ri-surface); white-space: pre-wrap; font-family: inherit; font-size: 0.8125rem; line-height: 1.6; max-height: 36rem; overflow: auto; overflow-wrap: anywhere; }
.js-diff { margin: 0; padding: 0.5rem 0; border: 1px solid var(--ri-border); border-radius: 0.625rem; background: var(--ri-surface); font-size: 0.8125rem; line-height: 1.55; max-height: 36rem; overflow: auto; }
.js-diff__line { display: grid; grid-template-columns: 4.5rem minmax(0, 1fr); gap: 0.5rem; padding: 0.0625rem 0.875rem; white-space: pre-wrap; overflow-wrap: anywhere; }
.js-diff__line[data-type="added"] { background: var(--ri-positive-bg); }
.js-diff__line[data-type="removed"] { background: var(--ri-danger-bg); }
.js-diff__tag { color: var(--ri-muted); font-size: 0.6875rem; padding-top: 0.125rem; }
.js-versions { display: grid; gap: 0.375rem; }
.js-version { display: grid; gap: 0.25rem; width: 100%; padding: 0.625rem 0.75rem; text-align: left; border: 1px solid var(--ri-border); border-radius: 0.625rem; background: var(--ri-surface); color: var(--ri-text); }
.js-version[aria-current="true"] { border-color: var(--ri-text); box-shadow: inset 0 0 0 1px var(--ri-text); }
.js-version__head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem 0.625rem; }
.js-tag { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0 0.4375rem; border: 1px solid var(--ri-border); border-radius: 999px; font-size: 0.6875rem; line-height: 1.25rem; color: var(--ri-muted); white-space: nowrap; }
.js-tag--strong { color: var(--ri-text); border-color: var(--ri-border-strong); font-weight: 550; }
.js-items { display: grid; gap: 0.5rem; }
.js-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.5rem; align-items: start; }
.js-suggestion { display: grid; gap: 0.5rem; padding: 0.875rem 1rem; border: 1px dashed var(--ri-border-strong); border-radius: 0.75rem; background: var(--ri-surface); }
.js-history { display: grid; gap: 0.5rem; }
.js-history__row { display: grid; gap: 0.125rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--ri-border); font-size: 0.8125rem; }
.js-history__row:last-child { border-bottom: 0; }
.js-people { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; }
.js-candidate { display: grid; gap: 0.5rem; padding: 0.875rem 1rem; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); }
.js-evidence { display: flex; flex-wrap: wrap; gap: 0.375rem; }
.js-workspace-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.js-workspace-head__text { display: grid; gap: 0.375rem; min-width: min(100%, 16rem); flex: 1 1 20rem; }
.js-workspace-title { font-size: 1.375rem; line-height: 1.25; font-weight: 600; letter-spacing: -0.02em; }
.js-check-row { display: flex; align-items: center; gap: 0.5rem; }
.js-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); gap: 0.875rem 1rem; }
.js-badge-fictional { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.75rem; color: var(--ri-muted); }
.js-toolbar-row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.75rem; }
.js-review-list { display: grid; gap: 1rem; }
.js-review-list > * { max-width: 56rem; }
.js-compare-wrap { overflow-x: auto; border: 1px solid var(--ri-border); border-radius: 0.625rem; }
.js-compare { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
.js-compare th, .js-compare td { padding: 0.625rem 0.75rem; border-bottom: 1px solid var(--ri-border); text-align: left; vertical-align: top; }
.js-compare thead th { color: var(--ri-muted); font-weight: 500; font-size: 0.75rem; }
@container ri-app (max-width: 1149.98px) {
  .js-grid-2 { grid-template-columns: minmax(0, 1fr); }
}
@container ri-app (max-width: 699.98px) {
  .js-strip { padding: 1rem; }
  .js-row { padding: 0.75rem 0.875rem; }
  .js-panel { padding: 1rem; }
  .js-diff__line { grid-template-columns: minmax(0, 1fr); gap: 0; }
}
`;
