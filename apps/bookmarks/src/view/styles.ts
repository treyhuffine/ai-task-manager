/** Bookmarks' own styles, prefixed bm-, on top of the kit's neutral tokens. */
export const BOOKMARKS_CSS = `
.bm-tools { display: grid; gap: 0.75rem; min-width: 0; }
.bm-search .ri-input, .bm-search input { font-size: 0.9375rem; }
.bm-list { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--ri-border); min-width: 0; }
.bm-list > li { display: flex; align-items: flex-start; gap: 0.25rem; min-width: 0; border-bottom: 1px solid var(--ri-border); }
.bm-row { display: grid; grid-template-columns: 2rem minmax(0, 1fr); gap: 0.75rem; flex: 1 1 auto; min-width: 0; padding: 0.75rem 0.5rem; border: 0; border-radius: 0.5rem; background: transparent; color: var(--ri-text); font: inherit; text-align: left; cursor: pointer; }
.bm-row:hover { background: var(--ri-soft); }
.bm-row[aria-current="true"] { background: var(--ri-selected); }
.bm-row:focus-visible { outline: 2px solid var(--ri-border-strong); outline-offset: -2px; }
.bm-site-mark { display: grid; place-items: center; width: 2rem; height: 2rem; border: 1px solid var(--ri-border); border-radius: 0.5rem; background: var(--ri-surface); color: var(--ri-muted); font-size: 0.8125rem; font-weight: 600; }
.bm-row__body { display: grid; gap: 0.1875rem; min-width: 0; }
.bm-row__title { font-size: 0.875rem; font-weight: 550; line-height: 1.35; overflow-wrap: anywhere; }
.bm-row__meta { color: var(--ri-muted); font-size: 0.75rem; line-height: 1.4; overflow-wrap: anywhere; }
.bm-row__text { color: var(--ri-muted); font-size: 0.8125rem; line-height: 1.45; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.bm-row__text mark { background: var(--ri-selected); color: var(--ri-text); border-radius: 0.125rem; }
.bm-tags { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.125rem; }
.bm-tag { padding: 0 0.375rem; border: 1px solid var(--ri-border); border-radius: 0.375rem; color: var(--ri-muted); font-size: 0.6875rem; line-height: 1.5; }
.bm-open { flex: 0 0 auto; margin: 0.75rem 0.25rem 0 0; }
.bm-more { display: flex; justify-content: center; padding: 0.75rem 0; }
.bm-page-text { max-height: 22rem; overflow: auto; padding: 0.75rem; border: 1px solid var(--ri-border); border-radius: 0.5rem; background: var(--ri-bg); color: var(--ri-text); font-size: 0.8125rem; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.bm-link { color: var(--ri-text); font-size: 0.8125rem; overflow-wrap: anywhere; }
.bm-code { width: 100%; min-width: 0; padding: 0.5rem 0.625rem; border: 1px solid var(--ri-border); border-radius: 0.5rem; background: var(--ri-bg); color: var(--ri-text); font: 0.75rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; resize: none; overflow-wrap: anywhere; }
.bm-copy { display: grid; gap: 0.375rem; min-width: 0; }
.bm-steps { display: grid; gap: 0.375rem; margin: 0; padding-left: 1.25rem; font-size: 0.875rem; line-height: 1.5; list-style: decimal; }
.bm-steps code { padding: 0.0625rem 0.25rem; border-radius: 0.25rem; background: var(--ri-soft); font-size: 0.8125rem; }
.bm-card { display: grid; gap: 0.75rem; padding: 1rem; border: 1px solid var(--ri-border); border-radius: 0.75rem; background: var(--ri-surface); min-width: 0; }
.bm-connections { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--ri-border); }
.bm-connections > li { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.625rem 0; border-bottom: 1px solid var(--ri-border); min-width: 0; }
.bm-bookmarklet { display: inline-block; padding: 0.375rem 0.75rem; border: 1px dashed var(--ri-border-strong); border-radius: 0.5rem; background: var(--ri-surface); color: var(--ri-text); font-size: 0.8125rem; font-weight: 550; text-decoration: none; cursor: grab; }
.bm-save { max-width: 32rem; }
.bm-counts { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; font-size: 0.8125rem; }
`;
