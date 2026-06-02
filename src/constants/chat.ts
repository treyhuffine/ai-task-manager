/**
 * Transcript page size — how many `chat_events` the initial snapshot
 * loads, and how many older events each scroll-up page fetches.
 *
 * Single source of truth shared by the server query
 * (`listChatEvents` default), the events route, and the client loader
 * (`useSessionEvents` / `useLoadOlderEvents`). Long sessions load only
 * the most recent page up front and page older history in lazily as the
 * user scrolls toward the top.
 */
export const CHAT_PAGE_SIZE = 1000;
