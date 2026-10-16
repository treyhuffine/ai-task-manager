/** Travel's own styles, prefixed tr-, on top of the kit's neutral tokens. */
export const TRAVEL_CSS = `
.tr-back { margin: 0 0 0.75rem -0.5rem; color: var(--ri-muted); }
.tr-back:hover { color: var(--ri-text); }
.tr-crumb { display: flex; flex-wrap: wrap; gap: 0.375rem; align-items: center; }
.tr-crumb__sep { color: var(--ri-muted); }
.tr-crumb__link { padding: 0; border: 0; background: transparent; color: inherit; font: inherit; letter-spacing: inherit; text-transform: inherit; text-decoration: underline; text-underline-offset: 0.25em; border-radius: 0.25rem; }
.tr-crumb__link:hover { color: var(--ri-text); }
.tr-tabs-row { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 0.5rem 1rem; }
.tr-tabs-row > .ri-tabs { flex: 1 1 18rem; }
.tr-review-link { margin-bottom: 0.5rem; }

/* Day rail */
.tr-days { display: flex; gap: 0.5rem; overflow-x: auto; padding: 0.125rem; margin: -0.125rem; scrollbar-width: thin; }
.tr-days .ri-segmented { display: flex; flex-wrap: nowrap; gap: 0.5rem; padding: 0; border: 0; background: transparent; }
.tr-days .ri-segmented__option {
  display: grid; justify-items: center; gap: 0.125rem; min-width: 3.75rem; padding: 0.5rem 0.625rem; border: 1px solid var(--ri-border);
  border-radius: 0.625rem; background: var(--ri-surface); color: var(--ri-text); font-size: 0.75rem; line-height: 1.25;
}
.tr-days .ri-segmented__option[aria-checked="true"] { background: var(--ri-button); color: var(--ri-on-button); border-color: var(--ri-button); }
.tr-day__weekday { color: inherit; opacity: 0.75; }
.tr-day__date { font-size: 0.9375rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.tr-day__mark { font-size: 0.625rem; opacity: 0.8; }
.tr-day__all { font-size: 0.8125rem; font-weight: 550; }
.tr-days .ri-segmented__option:first-child { align-content: center; min-width: 3rem; }

/* Itinerary */
.tr-itinerary { display: grid; gap: 1.75rem; min-width: 0; }
.tr-dayblock { display: grid; gap: 0.875rem; min-width: 0; }
.tr-dayhead { display: grid; gap: 0.25rem; }
.tr-dayhead p { color: var(--ri-muted); font-size: 0.8125rem; }
.tr-entries { display: grid; gap: 0.75rem; min-width: 0; }
.tr-entry { display: grid; grid-template-columns: 4.75rem minmax(0, 1fr); gap: 0.75rem; align-items: start; min-width: 0; }
.tr-entry__time { padding-top: 0.875rem; display: grid; gap: 0.125rem; font-variant-numeric: tabular-nums; }
.tr-entry__time strong { font-size: 0.875rem; font-weight: 550; }
.tr-entry__time span { font-size: 0.6875rem; color: var(--ri-muted); }
.tr-card {
  display: grid; gap: 0.375rem; width: 100%; min-width: 0; padding: 0.875rem 1rem; border: 1px solid var(--ri-border); border-radius: 0.75rem;
  background: var(--ri-surface); color: var(--ri-text); text-align: left;
}
button.tr-card:hover { border-color: var(--ri-border-strong); }
.tr-card[aria-current="true"] { border-color: var(--ri-text); box-shadow: inset 0 0 0 1px var(--ri-text); }
.tr-card--quiet { background: transparent; border-style: dashed; }
.tr-card--canceled .tr-card__title { text-decoration: line-through; text-decoration-thickness: 1px; color: var(--ri-muted); }
.tr-card__title { font-weight: 600; font-size: 0.9375rem; }
.tr-card__subtitle { color: var(--ri-muted); font-size: 0.8125rem; }
.tr-card__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.625rem; font-size: 0.75rem; color: var(--ri-muted); margin-top: 0.25rem; }
.tr-card__note { font-size: 0.75rem; color: var(--ri-warn); }
.tr-gap { display: grid; gap: 0.5rem; padding: 0.875rem 1rem; border: 1px dashed var(--ri-border-strong); border-radius: 0.75rem; min-width: 0; }
.tr-gap p { font-size: 0.8125rem; }
.tr-gap--dismissed { opacity: 0.75; }

/* Overview panel beside the itinerary */
.tr-overview { display: grid; gap: 1.25rem; padding: 1.375rem 1.5rem 1.5rem; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); min-width: 0; }
.tr-overview section { display: grid; gap: 0.625rem; min-width: 0; }
.tr-overview ul { display: grid; gap: 0.5rem; }
.tr-overview li { font-size: 0.8125rem; }
.tr-list-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.25rem 0.75rem; align-items: baseline; }

/* Trips list */
.tr-trips { display: grid; gap: 0.75rem; min-width: 0; }
.tr-trip {
  display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto; gap: 0.5rem 1.25rem; align-items: center; width: 100%;
  padding: 1rem 1.25rem; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); color: var(--ri-text); text-align: left;
}
.tr-trip:hover { border-color: var(--ri-border-strong); }
.tr-trip__title { font-weight: 600; font-size: 1rem; }
.tr-trip__dates { color: var(--ri-muted); font-size: 0.8125rem; }
.tr-trip__facts { display: grid; gap: 0.125rem; font-size: 0.8125rem; }
.tr-trip__attention { font-size: 0.75rem; color: var(--ri-muted); }
.tr-group-title { margin-top: 0.5rem; }

/* Ideas */
.tr-ideas { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr)); gap: 0.875rem; }
.tr-idea { display: grid; gap: 0.625rem; align-content: start; padding: 1rem 1.125rem; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); min-width: 0; }
.tr-idea[data-selected="true"] { border-color: var(--ri-text); box-shadow: inset 0 0 0 1px var(--ri-text); }
.tr-idea h3 { font-size: 0.9375rem; }
.tr-idea .ri-kv { gap: 0.375rem; }

/* Review and forms */
.tr-review-list { display: grid; gap: 1.25rem; max-width: 50rem; }
.tr-review-list > .ri-stack { max-width: 50rem; }
.tr-quotes { display: grid; gap: 0.375rem; margin: 0; padding: 0.625rem 0.875rem; border-left: 2px solid var(--ri-border-strong); background: var(--ri-soft); border-radius: 0 0.5rem 0.5rem 0; font-size: 0.8125rem; }
.tr-quotes q { quotes: none; }
.tr-form { display: grid; gap: 1rem; min-width: 0; }
.tr-form fieldset { display: grid; gap: 0.875rem; border: 1px solid var(--ri-border); border-radius: 0.625rem; padding: 0.875rem 1rem 1rem; margin: 0; min-width: 0; }
.tr-form legend { padding: 0 0.25rem; font-size: 0.8125rem; font-weight: 600; }
.tr-preview-item { display: grid; gap: 0.75rem; padding: 1rem; border: 1px solid var(--ri-border); border-radius: 0.75rem; min-width: 0; }
.tr-excerpt { max-height: 18rem; overflow: auto; white-space: pre-wrap; font-family: inherit; font-size: 0.8125rem; line-height: 1.55; margin: 0; padding: 0.75rem; border: 1px solid var(--ri-border); border-radius: 0.5rem; background: var(--ri-soft); }
.tr-settings { display: grid; gap: 1rem; max-width: 46rem; }
.tr-inline { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: center; }
.tr-history { display: grid; gap: 0.625rem; }
.tr-history li { display: grid; gap: 0.125rem; font-size: 0.8125rem; }
.tr-history span { color: var(--ri-muted); font-size: 0.75rem; }

@container ri-app (max-width: 699.98px) {
  .tr-entry { grid-template-columns: 3.75rem minmax(0, 1fr); gap: 0.5rem; }
  .tr-trip { grid-template-columns: minmax(0, 1fr); gap: 0.375rem; padding: 0.875rem 1rem; }
  .tr-overview { padding: 1rem; }
  .tr-days .ri-segmented__option { min-width: 3.25rem; padding: 0.4375rem 0.5rem; }
}
`;
