/**
 * People-specific layout on top of the kit's neutral tokens. Every class is
 * prefixed `pe-`. Layout follows the app container (`.ri-app` container
 * queries), never the viewport: one column below 700 px.
 */
export const peopleCss = `
.pe-tabs-row { position: relative; display: flex; align-items: flex-end; gap: 0.75rem; min-width: 0; border-bottom: 1px solid var(--ri-border); }
.pe-tabs-row .ri-tabs { flex: 1 1 auto; min-width: 0; border-bottom: 0; }
.pe-tabs-row .pe-add-view { flex: none; margin-bottom: 0.4rem; color: var(--ri-muted); }
.pe-tabs-row .pe-add-view:hover { color: var(--ri-text); }
.pe-banner { margin-bottom: 1rem; }
.pe-muted { color: var(--ri-muted); }
.pe-small { font-size: 0.75rem; }
.pe-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; min-width: 0; }
.pe-between { justify-content: space-between; }
.pe-grow { flex: 1 1 auto; min-width: 0; }
.pe-stack { display: grid; gap: 0.75rem; min-width: 0; }
.pe-stack--loose { gap: 1.5rem; }
.pe-section-label { font-size: 0.6875rem; font-weight: 650; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ri-muted); }
.pe-coverage { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--ri-border); font-size: 0.75rem; color: var(--ri-muted); line-height: 1.6; }
.pe-link { padding: 0; border: 0; background: none; color: inherit; text-decoration: underline; text-underline-offset: 0.2em; text-decoration-thickness: 1px; font: inherit; cursor: pointer; text-align: left; }
.pe-link:hover { text-decoration-thickness: 2px; }
.pe-name-cell { display: flex; align-items: center; gap: 0.625rem; min-width: 0; }
.pe-name-cell__text { display: grid; min-width: 0; }
.pe-name-cell__name { font-weight: 550; overflow-wrap: anywhere; }
.pe-name-cell__detail { font-size: 0.75rem; color: var(--ri-muted); }
.pe-unavailable { color: var(--ri-muted); }
.pe-pill { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.0625rem 0.5rem; border: 1px solid var(--ri-border); border-radius: 999px; font-size: 0.6875rem; color: var(--ri-muted); background: var(--ri-surface); white-space: nowrap; }
.pe-check-cell { display: inline-flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; }
.pe-check-cell input { width: 1rem; height: 1rem; accent-color: var(--ri-button); }

/* Today: a compact list of actionable people beside a generous workspace. */
.pe-today.ri-split[data-mode="split"][data-detail="true"] { grid-template-columns: minmax(13rem, 16rem) minmax(0, 1fr); gap: 2rem; }
.pe-today-list { display: grid; gap: 1.5rem; min-width: 0; }
.pe-today-group { display: grid; gap: 0.5rem; }
.pe-today-group h2 { font-size: 0.9375rem; font-weight: 600; }
.pe-today-item { display: grid; gap: 0.125rem; width: 100%; padding: 0.75rem 0.875rem; border: 1px solid transparent; border-radius: 0.625rem; background: transparent; text-align: left; color: inherit; cursor: pointer; }
.pe-today-item:hover { background: var(--ri-soft); }
.pe-today-item[aria-current="true"] { background: var(--ri-surface); border-color: var(--ri-border); }
.pe-today-item strong { font-weight: 600; }
.pe-today-item .pe-small { color: var(--ri-muted); }
.pe-lead { margin: 0; font-size: 0.9375rem; color: var(--ri-muted); }
.pe-anchor { scroll-margin-top: 1rem; }
.pe-welcome { list-style: none; margin: 0; padding: 0; display: grid; gap: 1rem; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.pe-welcome > li { display: grid; gap: 0.625rem; align-content: start; justify-items: start; padding: 1.25rem; border: 1px solid var(--ri-border); border-radius: var(--ri-radius-lg, 12px); background: var(--ri-surface); }
.pe-welcome > li p { margin: 0; font-size: 0.875rem; line-height: 1.5; color: var(--ri-muted); }
.pe-welcome > li .ri-h3 { margin: 0; }
@container ri-app (max-width: 899.98px) { .pe-welcome { grid-template-columns: minmax(0, 1fr); } }
.pe-today-empty { padding: 1rem 0; color: var(--ri-muted); font-size: 0.8125rem; }

/* Person and company workspaces. */
.pe-record { display: grid; gap: 1.25rem; min-width: 0; }
.pe-record-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.pe-record-head__who { display: flex; gap: 1rem; align-items: flex-start; min-width: 0; flex: 1 1 18rem; }
.pe-record-head__who .ri-avatar { width: 3.5rem; height: 3.5rem; font-size: 1rem; flex: none; }
.pe-record-title { font-size: 1.5rem; font-weight: 620; letter-spacing: -0.03em; line-height: 1.25; overflow-wrap: anywhere; }
.pe-record-sub { margin-top: 0.25rem; color: var(--ri-muted); }
.pe-record-meta { display: flex; flex-wrap: wrap; gap: 0.25rem 1.25rem; font-size: 0.75rem; color: var(--ri-muted); }
.pe-square { border-radius: 0.625rem !important; }
.pe-briefing { display: grid; gap: 1rem; padding: 1.25rem 1.5rem; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); min-width: 0; }
.pe-briefing__items { display: grid; gap: 0.75rem; }
.pe-briefing__item { display: grid; gap: 0.25rem; }
.pe-briefing__item p { line-height: 1.6; }
.pe-briefing__divider { height: 1px; background: var(--ri-border); }
.pe-commitment { display: grid; gap: 0.375rem; min-width: 0; }
.pe-commitment__action { font-weight: 550; }
.pe-quote { margin: 0; padding: 0.5rem 0.75rem; border-left: 2px solid var(--ri-border-strong); color: var(--ri-text); background: var(--ri-soft); border-radius: 0 0.5rem 0.5rem 0; font-size: 0.8125rem; line-height: 1.6; }
.pe-card { padding: 1rem 1.25rem; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); min-width: 0; }
.pe-card h3 { font-size: 0.9375rem; font-weight: 600; }
.pe-list { display: grid; gap: 0; min-width: 0; }
.pe-list > li { padding: 0.75rem 0; border-bottom: 1px solid var(--ri-border); min-width: 0; }
.pe-list > li:last-child { border-bottom: 0; }
.pe-company-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(16rem, 1fr); gap: 1.5rem; align-items: start; }
.pe-note-editor textarea { min-height: 8rem; }
.pe-identity { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem 0.75rem; }

/* Directory */
.pe-directory.ri-split[data-mode="split"][data-detail="true"] { grid-template-columns: minmax(0, 1.35fr) minmax(23rem, 1fr); }
.pe-directory-toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.625rem; margin-bottom: 0.875rem; }
.pe-directory-toolbar .ri-search { flex: 1 1 14rem; min-width: 0; }
.pe-directory-toolbar .pe-view-select { flex: 0 1 13rem; min-width: 9rem; }
.pe-directory-toolbar .ri-field { margin: 0; }
.pe-active-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; font-size: 0.75rem; color: var(--ri-muted); }
.pe-bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; padding: 0.5rem 0.75rem; border: 1px solid var(--ri-border); border-radius: 0.625rem; background: var(--ri-surface); }
.pe-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem 1rem; margin-top: 0.875rem; font-size: 0.75rem; color: var(--ri-muted); }

/* Follow-ups */
.pe-follow { display: grid; gap: 0.5rem; padding: 1rem 1.25rem; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); min-width: 0; }
.pe-follow__head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem 1rem; align-items: flex-start; }
.pe-follow__title { font-size: 0.9375rem; font-weight: 600; overflow-wrap: anywhere; }

/* Pipeline board */
.pe-board { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(14rem, 1fr); gap: 1rem; overflow-x: auto; padding-bottom: 0.5rem; align-items: start; }
.pe-column { display: grid; gap: 0.75rem; min-width: 0; align-content: start; }
.pe-column__head { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; padding: 0 0.25rem; font-size: 0.8125rem; font-weight: 600; }
.pe-column__head span { color: var(--ri-muted); font-weight: 500; }
.pe-column__empty { padding: 0.875rem 1rem; border: 1px dashed var(--ri-border-strong); border-radius: 0.75rem; color: var(--ri-muted); font-size: 0.75rem; }
.pe-opp { display: grid; gap: 0.5rem; padding: 0.875rem 1rem; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); min-width: 0; }
.pe-opp__title { padding: 0; border: 0; background: none; color: inherit; font: inherit; font-size: 0.9375rem; font-weight: 600; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.pe-opp__title:hover { text-decoration: underline; }
.pe-opp__next { padding-top: 0.5rem; border-top: 1px solid var(--ri-border); font-size: 0.75rem; }
.pe-stage-picker { max-width: 18rem; }
.pe-stage-row { display: grid; grid-template-columns: minmax(0, 1fr) 9rem auto; gap: 0.5rem; align-items: end; }

/* Sources */
.pe-source-row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 0.75rem 1.5rem; padding: 1.125rem 0; border-bottom: 1px solid var(--ri-border); }
.pe-source-row:last-child { border-bottom: 0; }
.pe-source-row > div:first-child { flex: 1 1 18rem; min-width: 0; }
.pe-import-table { max-height: 18rem; overflow: auto; }
.pe-review { display: grid; gap: 0.75rem; padding: 1rem 1.25rem; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); }
.pe-review__records { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 0.75rem; }
.pe-review__record { padding: 0.75rem; border: 1px solid var(--ri-border); border-radius: 0.625rem; background: var(--ri-bg); min-width: 0; }

@container ri-app (max-width: 1149.98px) {
  .pe-company-grid { grid-template-columns: minmax(0, 1fr); }
}
@container ri-app (max-width: 699.98px) {
  .pe-record-title { font-size: 1.3125rem; }
  .pe-record-head__who .ri-avatar { width: 2.75rem; height: 2.75rem; font-size: 0.875rem; }
  .pe-briefing { padding: 1rem; }
  .pe-follow { padding: 0.875rem 1rem; }
  .pe-directory-toolbar .pe-view-select { flex: 1 1 100%; }
  .pe-stage-row { grid-template-columns: minmax(0, 1fr); }
  .pe-tabs-row { flex-wrap: wrap; }
}
`;
