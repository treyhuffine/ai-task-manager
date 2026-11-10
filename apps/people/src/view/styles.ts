/**
 * People-specific layout on top of the kit's neutral tokens. Every class is
 * prefixed `pe-`. Layout follows the app container (`.ri-app` container
 * queries), never the viewport: one column below 700 px.
 *
 * The look follows modern CRM working surfaces (Twenty, Attio): one compact
 * bar instead of a page headline, a dense table with grid lines, related
 * records as small chips, records with a fields column beside their
 * sections, and flat sections separated by hairlines instead of nested
 * cards. One radius scale: 6 px for controls and cards, 4 px for chips.
 * Never a colored edge on a rounded box.
 */
export const peopleCss = `
/* Shell. Ri's own header already names the app, so the view starts at its sections. */
.pe-shell { max-width: 90rem; margin: 0 auto; padding: 0.5rem 1.5rem 3rem; min-width: 0; font-size: 0.8125rem; }
.pe-top { display: flex; align-items: flex-end; gap: 0.75rem; min-width: 0; margin-bottom: 1.25rem; border-bottom: 1px solid var(--ri-border); }
.pe-top .ri-tabs { flex: 1 1 auto; min-width: 0; border-bottom: 0; }
.pe-top .ri-tabs__list { gap: 1.25rem; }
.pe-top .ri-tab { padding: 0.6875rem 0.125rem 0.75rem; font-size: 0.8125rem; }
.pe-top .ri-tab[aria-selected="true"] { font-weight: 600; }
.pe-top__actions { flex: none; display: flex; align-items: center; gap: 0.375rem; padding-bottom: 0.4375rem; }
.pe-notice-slot { margin-bottom: 1rem; }
@container ri-app (max-width: 699.98px) {
  .pe-shell { padding: 0.25rem 1rem 2.5rem; }
  .pe-top { flex-wrap: wrap; margin-bottom: 1rem; }
  .pe-top__actions { order: -1; width: 100%; justify-content: flex-end; padding: 0.25rem 0 0; }
}

/* Controls: smaller radius and height than the kit default, for a working surface. */
.pe-shell .ri-button, .ri-dialog .ri-button { border-radius: 0.375rem; }
.ri-dialog .ri-input, .ri-dialog .ri-select, .ri-dialog .ri-textarea { border-radius: 0.375rem; }
.pe-shell .ri-button--sm { min-height: 1.75rem; padding: 0.1875rem 0.5625rem; border-radius: 0.375rem; }
.pe-shell .ri-button--link { color: var(--ri-muted); text-decoration-color: var(--ri-border-strong); }
.pe-shell .ri-button--link:hover:not(:disabled) { color: var(--ri-text); text-decoration-color: currentColor; }
.pe-shell .ri-input, .pe-shell .ri-select, .pe-shell .ri-textarea, .pe-shell .ri-search__box { border-radius: 0.375rem; }
.pe-shell .ri-search__box { min-height: 2rem; }
.pe-shell .ri-segmented { border-radius: 0.4375rem; padding: 0.125rem; }
.pe-shell .ri-segmented__option { min-height: 1.625rem; border-radius: 0.3125rem; font-size: 0.75rem; }
.pe-shell .ri-notice { padding: 0.625rem 0.875rem; border-radius: 0.5rem; }
.pe-shell .ri-notice__marker { width: 0.875rem; height: 0.875rem; margin-top: 0.1875rem; }
.pe-shell .ri-h2 { font-size: 1rem; letter-spacing: -0.01em; }
.pe-shell .ri-h3 { font-size: 0.875rem; }
.pe-shell .ri-empty__title { font-size: 1.0625rem; }
.pe-shell .ri-avatar { font-weight: 600; }
.pe-shell .ri-avatar--sm { width: 1.5rem; height: 1.5rem; font-size: 0.625rem; }
.pe-shell .ri-status { border-radius: 0.25rem; }
.pe-notice-slot .ri-notice__content > div { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 0.5rem; }

/* Small shared pieces. */
.pe-muted { color: var(--ri-muted); }
.pe-small { font-size: 0.75rem; }
.pe-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; min-width: 0; }
.pe-between { justify-content: space-between; }
.pe-grow { flex: 1 1 auto; min-width: 0; }
.pe-stack { display: grid; gap: 0.75rem; min-width: 0; }
.pe-stack--loose { gap: 1.5rem; }
.pe-section-label { font-size: 0.75rem; font-weight: 550; color: var(--ri-muted); }
.pe-coverage { margin-top: 2rem; padding-top: 0.875rem; border-top: 1px solid var(--ri-border); font-size: 0.6875rem; color: var(--ri-muted); line-height: 1.6; }
.pe-link { padding: 0; border: 0; background: none; color: inherit; text-decoration: underline; text-decoration-color: var(--ri-border-strong); text-underline-offset: 0.2em; text-decoration-thickness: 1px; font: inherit; cursor: pointer; text-align: left; }
.pe-link:hover { text-decoration-color: currentColor; }
.pe-empty-cell { color: var(--ri-border-strong); }
.pe-unavailable { color: var(--ri-muted); }
.pe-pill { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.0625rem 0.375rem; border-radius: 0.25rem; font-size: 0.6875rem; line-height: 1.5; color: var(--ri-muted); background: var(--ri-soft); white-space: nowrap; }
.pe-check-cell { display: inline-flex; align-items: center; justify-content: center; width: 1.25rem; height: 1.25rem; }
.pe-check-cell input { width: 0.875rem; height: 0.875rem; accent-color: var(--ri-button); }

/* A related record: initials and name in a small soft box, like a CRM relation cell. */
.pe-chip { display: inline-flex; align-items: center; gap: 0.375rem; max-width: 100%; min-width: 0; padding: 0.0625rem 0.375rem 0.0625rem 0.125rem; border: 0; border-radius: 0.25rem; background: var(--ri-soft); color: var(--ri-text); font: inherit; font-size: 0.8125rem; line-height: 1.5; text-align: left; vertical-align: middle; cursor: pointer; }
.pe-chip:hover { background: var(--ri-selected); }
.pe-chip--static { cursor: inherit; }
.pe-chip--static:hover { background: var(--ri-soft); }
.pe-chip__mark { display: inline-grid; place-items: center; flex: none; width: 1rem; height: 1rem; border-radius: 50%; background: var(--ri-surface); color: var(--ri-muted); font-size: 0.5625rem; font-weight: 650; line-height: 1; }
.pe-chip--company .pe-chip__mark { border-radius: 0.1875rem; }
.pe-chip__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.pe-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem; min-width: 0; }

/* A source citation: small and quiet, never an underlined sentence. */
.pe-cite { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0 0.3125rem; margin-left: 0.25rem; border: 1px solid var(--ri-border); border-radius: 0.25rem; background: var(--ri-surface); color: var(--ri-muted); font: inherit; font-size: 0.6875rem; line-height: 1.45; vertical-align: 0.0625rem; white-space: nowrap; cursor: pointer; }
.pe-cite:hover { color: var(--ri-text); border-color: var(--ri-border-strong); }
.pe-cite svg { width: 0.625rem; height: 0.625rem; }

/* Tables: a dense grid, the way a CRM directory reads. */
.pe-shell .ri-table-wrap { border-radius: 0.5rem; }
.pe-shell .ri-table { font-size: 0.8125rem; }
.pe-shell .ri-table th, .pe-shell .ri-table td { padding: 0.4375rem 0.75rem; vertical-align: middle; border-right: 1px solid var(--ri-border); }
.pe-shell .ri-table tr > :last-child { border-right: 0; }
.pe-shell .ri-table thead th { padding-top: 0.5rem; padding-bottom: 0.5rem; font-size: 0.75rem; font-weight: 500; background: var(--ri-surface); }
.pe-shell .ri-table tbody th { font-weight: 550; }
.pe-shell .ri-table tbody tr[aria-current="true"] { background: var(--ri-selected); }
.pe-shell .ri-table td { white-space: nowrap; max-width: 22rem; overflow: hidden; text-overflow: ellipsis; }
.pe-name-cell { display: flex; align-items: center; gap: 0.5rem; min-width: 0; white-space: nowrap; }
.pe-name-cell__name { font-weight: 550; overflow: hidden; text-overflow: ellipsis; }
.pe-cell-detail { margin-left: 0.375rem; color: var(--ri-muted); }
.pe-clip { display: block; max-width: 20rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pe-cell-date { color: var(--ri-muted); font-variant-numeric: tabular-nums; }
.pe-cell-due { margin-left: 0.375rem; color: var(--ri-muted); }
.pe-cell-due[data-overdue="true"] { color: var(--ri-warn); }

/* Directory */
.pe-directory.ri-split[data-mode="split"][data-detail="true"] { grid-template-columns: minmax(0, 1.35fr) minmax(23rem, 1fr); gap: 0; }
.pe-directory.ri-split[data-mode="split"][data-detail="true"] > .ri-split__pane { padding-right: 1.5rem; }
.pe-directory.ri-split[data-mode="split"] > .ri-split__detail { top: 0.5rem; max-height: calc(100vh - 1rem); overflow-y: auto; padding-left: 1.5rem; border-left: 1px solid var(--ri-border); }
.pe-directory-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; margin-bottom: 0.625rem; min-width: 0; }
.pe-view-picker { display: inline-flex; align-items: center; gap: 0.375rem; min-width: 0; margin-right: auto; }
.pe-view-picker .ri-field { margin: 0; }
.pe-view-picker .ri-select { width: auto; field-sizing: content; min-height: 1.875rem; padding-top: 0.1875rem; padding-bottom: 0.1875rem; padding-left: 0.5rem; margin-left: -0.5rem; border-color: transparent; background-color: transparent; font-weight: 600; font-size: 0.8125rem; max-width: 16rem; }
.pe-view-picker .ri-select:hover { background-color: var(--ri-soft); }
.pe-view-count { color: var(--ri-muted); font-variant-numeric: tabular-nums; }
.pe-directory-toolbar .ri-search { flex: 0 1 13rem; min-width: 9rem; }
/* Quiet actions read as secondary: muted until hovered. */
.pe-shell .ri-button--quiet { color: var(--ri-muted); font-weight: 500; }
.pe-shell .ri-button--quiet:hover:not(:disabled) { color: var(--ri-text); }
.pe-directory-toolbar .ri-button--quiet[aria-pressed="true"] { color: var(--ri-text); background: var(--ri-soft); }
.pe-directory-toolbar .ri-search__box { min-height: 1.875rem; padding: 0 0.625rem; }
.pe-directory-toolbar .ri-search__box input { padding: 0.25rem 0; font-size: 0.8125rem; }
.pe-active-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; margin-bottom: 0.625rem; font-size: 0.75rem; color: var(--ri-muted); }
.pe-bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-bottom: 0.625rem; padding: 0.375rem 0.625rem; border-radius: 0.375rem; background: var(--ri-soft); }
.pe-footer { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.5rem 1rem; margin-top: 0.625rem; font-size: 0.6875rem; color: var(--ri-muted); }

/* Records: a header, then a fields column beside the sections when there is room. */
.pe-record { container: pe-record / inline-size; display: grid; gap: 1.25rem; min-width: 0; }
.pe-record-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem 1rem; min-width: 0; }
.pe-record-head__who { display: flex; gap: 0.75rem; align-items: center; min-width: 0; flex: 1 1 16rem; }
.pe-record-head__who .ri-avatar { width: 2.5rem; height: 2.5rem; font-size: 0.8125rem; flex: none; }
.pe-record-head__text { display: grid; gap: 0.125rem; min-width: 0; }
.pe-record-title { font-size: 1.125rem; font-weight: 620; letter-spacing: -0.015em; line-height: 1.3; overflow-wrap: anywhere; }
.pe-record-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.5rem; color: var(--ri-muted); min-width: 0; }
.pe-square { border-radius: 0.375rem !important; }
.pe-record-body { display: grid; gap: 1.5rem; min-width: 0; align-items: start; }
.pe-record-main { display: grid; gap: 1.25rem; min-width: 0; }
@container pe-record (min-width: 46rem) {
  .pe-record-body { grid-template-columns: 17rem minmax(0, 1fr); gap: 2rem; }
  .pe-fields { position: sticky; top: 0.75rem; }
}

/* The fields column: label and value rows, then related records. */
.pe-fields { display: grid; gap: 1.25rem; min-width: 0; align-content: start; }
.pe-fields__group { display: grid; gap: 0.125rem; min-width: 0; }
.pe-fields__head { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; font-size: 0.75rem; font-weight: 600; color: var(--ri-muted); }
/* Narrow records (an inspector, a phone) put the label over the value, two to a row. Wide ones list label and value side by side. */
.pe-fields dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 0.625rem 1rem; min-width: 0; }
.pe-field { display: grid; gap: 0.0625rem; min-width: 0; }
@container pe-record (min-width: 46rem) {
  .pe-fields dl { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .pe-field { grid-template-columns: 6rem minmax(0, 1fr); gap: 0.5rem; align-items: baseline; padding: 0.25rem 0; }
}
.pe-field__label { font-size: 0.75rem; color: var(--ri-muted); }
.pe-field__value { min-width: 0; overflow-wrap: break-word; }
.pe-field__line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pe-field__value .pe-chip { font-size: 0.75rem; }
.pe-field__empty { color: var(--ri-border-strong); }
.pe-related { display: grid; gap: 0.125rem; min-width: 0; }
.pe-related__row { display: flex; align-items: center; gap: 0.5rem; width: 100%; min-width: 0; padding: 0.3125rem 0.375rem; margin: 0 -0.375rem; border: 0; border-radius: 0.375rem; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.pe-related__row:hover { background: var(--ri-soft); }
.pe-related__text { display: grid; min-width: 0; }
.pe-related__name { font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pe-related__detail { font-size: 0.6875rem; color: var(--ri-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Flat sections inside a record: a heading and content, separated by space, not boxes. */
.pe-section { display: grid; gap: 0.75rem; min-width: 0; }
.pe-section__head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.5rem; min-width: 0; }
.pe-section__title { font-size: 0.875rem; font-weight: 600; }
.pe-section + .pe-section { padding-top: 1.25rem; border-top: 1px solid var(--ri-border); }
.pe-briefing__items { display: grid; gap: 0.625rem; }
.pe-briefing__item { line-height: 1.6; }
.pe-briefing__meta { font-size: 0.6875rem; color: var(--ri-muted); }
.pe-commitments { display: grid; min-width: 0; }
.pe-commitment { display: grid; gap: 0.3125rem; min-width: 0; padding: 0.75rem 0; border-top: 1px solid var(--ri-border); }
.pe-commitments > .pe-commitment:first-child { border-top: 0; padding-top: 0; }
.pe-commitment__kind { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; font-size: 0.6875rem; color: var(--ri-muted); }
.pe-commitment__action { font-weight: 550; }
.pe-commitment .ri-button-row { gap: 0.25rem 0.375rem; }
.pe-quote { margin: 0; padding: 0.5rem 0.75rem; color: var(--ri-text); background: var(--ri-soft); border-radius: 0.375rem; font-size: 0.8125rem; line-height: 1.6; }
.pe-card { padding: 0.875rem 1rem; border: 1px solid var(--ri-border); border-radius: 0.5rem; background: var(--ri-surface); min-width: 0; }
.pe-list { display: grid; gap: 0; min-width: 0; }
.pe-list > li { padding: 0.625rem 0; border-bottom: 1px solid var(--ri-border); min-width: 0; }
.pe-list > li:last-child { border-bottom: 0; }
.pe-note-editor textarea { min-height: 6rem; }
.pe-note { display: grid; gap: 0.375rem; padding: 0.75rem 0; border-bottom: 1px solid var(--ri-border); min-width: 0; }
.pe-note:last-child { border-bottom: 0; }
.pe-note__body { white-space: pre-wrap; line-height: 1.6; }
.pe-identity { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem 0.625rem; }

/* Record sections in the kit's timeline: compact, quiet source links. */
.pe-shell .ri-timeline__item { padding-bottom: 1rem; }
.pe-shell .ri-timeline__date { font-size: 0.75rem; color: var(--ri-muted); }
.pe-shell .ri-timeline__title { font-weight: 550; }
.pe-shell .ri-timeline__actions .ri-button--link { text-decoration: none; font-size: 0.6875rem; }
.pe-shell .ri-timeline__actions .ri-button--link:hover { text-decoration: underline; }

/* Today: a compact list of people to act on beside the selected record. */
.pe-today.ri-split[data-mode="split"][data-detail="true"] { grid-template-columns: minmax(14rem, 17rem) minmax(0, 1fr); gap: 0; }
.pe-today.ri-split[data-mode="split"][data-detail="true"] > .ri-split__pane { padding-right: 1.25rem; }
.pe-today.ri-split[data-mode="split"] > .ri-split__detail { top: 0.5rem; padding-left: 1.75rem; border-left: 1px solid var(--ri-border); }
.pe-today-list { display: grid; gap: 1.25rem; min-width: 0; }
.pe-today-group { display: grid; gap: 0.125rem; }
.pe-today-group h2 { display: flex; justify-content: space-between; margin-bottom: 0.25rem; font-size: 0.75rem; font-weight: 600; color: var(--ri-muted); }
.pe-today-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 0.5rem; width: 100%; padding: 0.4375rem 0.5rem; margin: 0 -0.5rem; border: 0; border-radius: 0.375rem; background: transparent; text-align: left; color: inherit; cursor: pointer; width: calc(100% + 1rem); }
.pe-today-item:hover { background: var(--ri-soft); }
.pe-today-item[aria-current="true"] { background: var(--ri-selected); }
.pe-today-item strong { font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pe-today-item__when { font-size: 0.6875rem; color: var(--ri-muted); white-space: nowrap; text-align: right; }
.pe-today-item__what { grid-column: 1 / -1; font-size: 0.75rem; color: var(--ri-muted); }
.pe-today-item__extra { grid-column: 1 / -1; font-size: 0.75rem; }
.pe-today-empty { padding: 0.25rem 0; color: var(--ri-muted); font-size: 0.75rem; }
.pe-lead { margin: 0; font-size: 0.875rem; color: var(--ri-muted); }
.pe-anchor { scroll-margin-top: 1rem; }
.pe-welcome { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.75rem; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.pe-welcome > li { display: grid; gap: 0.5rem; align-content: start; justify-items: start; padding: 1rem 1.125rem; border: 1px solid var(--ri-border); border-radius: 0.5rem; background: var(--ri-surface); }
.pe-welcome > li p { margin: 0; font-size: 0.8125rem; line-height: 1.55; color: var(--ri-muted); }
.pe-welcome > li .ri-h3 { margin: 0; }
@container ri-app (max-width: 899.98px) { .pe-welcome { grid-template-columns: minmax(0, 1fr); } }

/* Follow-ups: one list with hairlines. */
.pe-follow-list { display: grid; min-width: 0; border-top: 1px solid var(--ri-border); }
.pe-follow { display: grid; gap: 0.375rem; padding: 0.875rem 0; border-bottom: 1px solid var(--ri-border); min-width: 0; }
.pe-follow__head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.375rem 1rem; align-items: center; }
.pe-follow__title { font-weight: 550; overflow-wrap: anywhere; }
.pe-follow .pe-commitment { padding: 0; border-top: 0; }

/* Company overview and opportunity layout. */
.pe-company-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(15rem, 1fr); gap: 2rem; align-items: start; }
.pe-next { display: grid; gap: 0.25rem; }
.pe-next__label { font-weight: 550; }

/* Pipeline board */
.pe-board-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; min-width: 0; }
.pe-board-head__title { display: flex; align-items: baseline; gap: 0.5rem; min-width: 0; }
.pe-board-head__title h2 { font-size: 0.9375rem; font-weight: 600; }
.pe-board-head__tools { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; }
.pe-board { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(13.5rem, 1fr); gap: 0.75rem; overflow-x: auto; padding-bottom: 0.5rem; align-items: start; }
.pe-column { display: grid; gap: 0.5rem; min-width: 0; align-content: start; }
.pe-column__head { display: flex; align-items: center; gap: 0.375rem; padding: 0 0.125rem 0.25rem; font-size: 0.75rem; font-weight: 600; }
.pe-column__head span { color: var(--ri-muted); font-weight: 500; font-variant-numeric: tabular-nums; }
.pe-stage { display: inline-flex; align-items: center; padding: 0.0625rem 0.4375rem; border-radius: 0.25rem; background: var(--ri-soft); color: var(--ri-text); font-size: 0.75rem; font-weight: 550; }
.pe-stage[data-kind="succeeded"] { background: var(--ri-positive-bg); }
.pe-column__empty { padding: 0.625rem 0.75rem; border: 1px dashed var(--ri-border); border-radius: 0.375rem; color: var(--ri-muted); font-size: 0.75rem; }
.pe-opp { display: grid; gap: 0.375rem; padding: 0.625rem 0.75rem; border: 1px solid var(--ri-border); border-radius: 0.375rem; background: var(--ri-surface); min-width: 0; }
.pe-opp:hover { border-color: var(--ri-border-strong); }
.pe-opp__title { padding: 0; border: 0; background: none; color: inherit; font: inherit; font-size: 0.8125rem; font-weight: 600; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.pe-opp__title:hover { text-decoration: underline; text-decoration-color: var(--ri-border-strong); text-underline-offset: 0.2em; }
.pe-opp__field { display: flex; align-items: baseline; gap: 0.375rem; min-width: 0; font-size: 0.75rem; }
.pe-opp__field > span:first-child { flex: none; width: 3.75rem; color: var(--ri-muted); }
.pe-opp__foot { display: flex; justify-content: flex-end; margin-top: 0.125rem; }
.pe-stage-picker { max-width: 18rem; }
.pe-stage-row { display: grid; grid-template-columns: minmax(0, 1fr) 9rem auto; gap: 0.5rem; align-items: end; }

/* Sources */
.pe-source-row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 0.75rem 1.5rem; padding: 1rem 0; border-bottom: 1px solid var(--ri-border); }
.pe-source-row:last-child { border-bottom: 0; }
.pe-source-row > div:first-child { flex: 1 1 18rem; min-width: 0; }
.pe-import-table { max-height: 18rem; overflow: auto; }
.pe-review { display: grid; gap: 0.75rem; padding: 0.875rem 1rem; border: 1px solid var(--ri-border); border-radius: 0.5rem; background: var(--ri-surface); }
.pe-review__records { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 0.75rem; }
.pe-review__record { padding: 0.75rem; border-radius: 0.375rem; background: var(--ri-soft); min-width: 0; }
.pe-shell .ri-account { padding: 1rem 1.125rem; border-radius: 0.5rem; }

@container ri-app (max-width: 1149.98px) {
  .pe-company-grid { grid-template-columns: minmax(0, 1fr); }
}
@container ri-app (max-width: 699.98px) {
  .pe-record-title { font-size: 1.0625rem; }
  .pe-directory-toolbar .ri-search { flex: 1 1 100%; }
  .pe-view-picker { flex: 1 1 100%; }
  .pe-stage-row { grid-template-columns: minmax(0, 1fr); }
}
`;
