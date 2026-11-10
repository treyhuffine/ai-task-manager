/** @jsxRuntime automatic */
/** @jsxImportSource react */
/** The working screen: search first, then the links, with a selected link in the inspector. */
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell, AskRiButton, Button, EmptyState, ErrorState, ExternalIcon, FilterChips, LoadingState, Notice, plural, SearchField, SectionPanel, SplitView, useQuery, useRiApp } from "@ri/app-kit/ui";
import type { BookmarkRecord } from "../schemas.js";
import { AddDialog } from "./add.js";
import { MainTabs, useNav, type Route } from "./app.js";
import { ImportDialog } from "./import.js";
import { BookmarkInspector } from "./inspector.js";
import { initialOf, isHttps, savedLabel } from "./util.js";

interface List { items: BookmarkRecord[]; nextCursor: string | null; coverage: { complete: boolean; note: string | null }; revision: string }
interface Tags { items: { tag: string; count: number }[] }
type ListRoute = Extract<Route, { section: "list" }>;

/** The search words picked out in a passage, so a person sees why it matched. */
function Marked({ text, query }: { text: string; query: string }) {
  const words = query.normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1).slice(0, 12);
  if (!words.length) return <>{text}</>;
  const pattern = new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu");
  return <>{text.split(pattern).map((part, index) => (index % 2 ? <mark key={index}>{part}</mark> : part))}</>;
}

function StateNotice() {
  const app = useRiApp();
  const { data } = useNav();
  if (data.fictional) return <Notice tone="info" title="Fictional preview.">These links and their text are examples. No page is requested.</Notice>;
  if (!data.owner || !data.setup.waiting) return null;
  if (data.setup.reading) return <p className="ri-muted ri-small">{plural(data.setup.waiting, "page is", "pages are")} waiting to be read. Search covers their titles and links until then.</p>;
  return (
    <Notice tone="info" title="Search only covers titles and links for now." action={<Button size="sm" onClick={() => void app.openSources()}>Turn on reading</Button>}>
      {plural(data.setup.waiting, "saved page hasn't", "saved pages haven't")} been read. Allow Bookmarks to read the pages you save, and search will find what they say.
    </Notice>
  );
}

export function ListScreen() {
  const app = useRiApp();
  const { route: anyRoute, navigate, back, data } = useNav();
  const route = anyRoute as ListRoute;
  const [typed, setTyped] = useState(route.query);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [extra, setExtra] = useState<{ items: BookmarkRecord[]; cursor: string | null; base: string } | null>(null);
  // A search waits a moment before it applies, so build on the latest route, not the one from when it was typed.
  const latest = useRef(route);
  latest.current = route;
  const update = (patch: Partial<ListRoute>) => navigate({ ...latest.current, ...patch });
  const close = () => back({ ...latest.current, bookmarkId: null });
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);
  const onType = (value: string) => {
    setTyped(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => update({ query: value.trim(), bookmarkId: null }), 200);
  };
  const input = useMemo(() => ({ limit: 50, ...(route.query ? { query: route.query } : {}), ...(route.tag ? { tag: route.tag } : {}) }), [route.query, route.tag]);
  const list = useQuery<List>("list_bookmarks", input);
  const tags = useQuery<Tags>("list_tags", {});
  // Links arrive from outside this view, so look again whenever the person comes back to it.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") { void list.reload(); void tags.reload(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [list.reload, tags.reload]);
  // Keyed by what was asked, not the data revision: a page read in the background shouldn't collapse the list.
  const base = `${route.query}\u0000${route.tag}`;
  const more = extra?.base === base ? extra : null;
  const items = [...new Map([...(list.data?.items ?? []), ...(more?.items ?? [])].map((item) => [item.id, item])).values()];
  const cursor = more ? more.cursor : list.data?.nextCursor ?? null;
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const next = await app.call<List>("list_bookmarks", { ...input, cursor });
      setExtra({ items: [...(more?.items ?? []), ...next.items], cursor: next.nextCursor, base });
    } finally {
      setLoadingMore(false);
    }
  };
  const total = data.setup.total;
  const empty = list.data && !items.length && !route.query && !route.tag;
  const context = data.fictional || total ? `${plural(total, "link", "links")} saved` : "Save links from anywhere and find them again by what the page said.";
  const open = (item: BookmarkRecord) => (isHttps(item.url) ? void app.openExternal(item.url) : update({ bookmarkId: item.id }));
  return (
    <AppShell
      eyebrow="Bookmarks"
      title="Bookmarks"
      context={context}
      secondaryActions={data.owner ? (
        <>
          <Button variant="quiet" onClick={() => setImporting(true)}>Import</Button>
          {!empty && <AskRiButton prompt="Search my bookmarks for " />}
        </>
      ) : undefined}
      primaryAction={data.owner ? <Button variant="primary" onClick={() => setAdding(true)}>Add link</Button> : undefined}
      tabs={<MainTabs value="list" />}
      notice={<StateNotice />}
    >
      <SectionPanel panelId="bm-main" value="list">
        {list.error && !list.data ? (
          <ErrorState title="Bookmarks could not load" message={list.error} onRetry={() => void list.reload()} />
        ) : !list.data ? (
          <LoadingState label="Loading bookmarks" />
        ) : empty ? (
          <EmptyState
            title="Save your first link"
            action={data.owner ? (
              <>
                <Button variant="primary" onClick={() => setImporting(true)}>Import bookmarks</Button>
                <Button onClick={() => navigate({ section: "connect" })}>Connect a browser</Button>
              </>
            ) : undefined}
          >
            <p>Bring in what your browser already has, then keep saving the way you always do. Search finds a page by what it said, and your agents can use it too.</p>
          </EmptyState>
        ) : (
          <SplitView
            detailOpen={Boolean(route.bookmarkId)}
            onBack={close}
            backLabel="All bookmarks"
            detail={route.bookmarkId ? <BookmarkInspector key={route.bookmarkId} id={route.bookmarkId} onClose={close} onChanged={(change) => {
              void list.reload();
              void tags.reload();
              setExtra((current) => current && { ...current, items: change.deleted ? current.items.filter((item) => item.id !== change.deleted) : current.items.map((item) => (item.id === change.record?.id ? change.record : item)) });
            }} /> : null}
            list={
              <div className="ri-stack">
                <div className="bm-tools">
                  <SearchField className="bm-search" label="Search bookmarks" hideLabel placeholder="Search titles, links, notes and page text" value={typed} onChange={onType} />
                  {(tags.data?.items.length ?? 0) > 0 && (
                    <FilterChips
                      label="Filter by tag"
                      clearLabel="Clear tag"
                      items={tags.data!.items.slice(0, 12).map((item) => ({ id: item.tag, label: item.tag, count: item.count }))}
                      value={route.tag ? [route.tag] : []}
                      onChange={(next) => update({ tag: next.at(-1) ?? "", bookmarkId: null })}
                    />
                  )}
                </div>
                {list.data.coverage.note && <p className="ri-muted ri-small">{list.data.coverage.note}</p>}
                {items.length ? (
                  <ul className="bm-list" aria-label="Saved links" aria-busy={list.refreshing}>
                    {items.map((item) => (
                      <li key={item.id}>
                        <button type="button" className="bm-row" aria-current={route.bookmarkId === item.id} onClick={() => update({ bookmarkId: item.id })}>
                          <span className="bm-site-mark" aria-hidden="true">{initialOf(item.site)}</span>
                          <span className="bm-row__body">
                            <span className="bm-row__title">{item.title}</span>
                            <span className="bm-row__meta">{item.site}, {savedLabel(item.savedAt)}</span>
                            {(item.snippet ?? item.excerpt) && <span className="bm-row__text"><Marked text={(item.snippet ?? item.excerpt)!} query={route.query} /></span>}
                            {item.tags.length > 0 && <span className="bm-tags">{item.tags.slice(0, 6).map((tag) => <span className="bm-tag" key={tag}>{tag}</span>)}</span>}
                          </span>
                        </button>
                        {isHttps(item.url) && (
                          <button type="button" className="ri-icon-button bm-open" aria-label={`Open ${item.title}`} onClick={() => open(item)}><ExternalIcon /></button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState compact title="Nothing matches">
                    <p>{route.query ? `No saved link mentions "${route.query}"${route.tag ? ` under ${route.tag}` : ""}.` : `No saved link is tagged ${route.tag}.`}</p>
                  </EmptyState>
                )}
                {cursor && <div className="bm-more"><Button busy={loadingMore} busyLabel="Loading" onClick={() => void loadMore()}>Show more</Button></div>}
              </div>
            }
          />
        )}
      </SectionPanel>
      <AddDialog open={adding} onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); void list.reload(); void tags.reload(); update({ bookmarkId: id }); }} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} onApplied={() => { void list.reload(); void tags.reload(); }} />
    </AppShell>
  );
}
