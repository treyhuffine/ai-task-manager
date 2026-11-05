/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Bookmarks' view root. The search, tag and selection live in the host URL
 * through setLocation, so reopening returns to the same place. Selection and
 * filters reach the chat as context, never as authority: the backend
 * re-resolves them under the chat's own access.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppFrame, installStyles, LoadingState, SectionTabs, useRiApp } from "@ri/app-kit/ui";
import type { OpenData } from "../schemas.js";
import { AccessScreen } from "./access.js";
import { ConnectScreen } from "./connect.js";
import { ListScreen } from "./list.js";
import { SaveScreen } from "./save.js";
import { BOOKMARKS_CSS } from "./styles.js";

export type Route =
  | { section: "list"; bookmarkId: string | null; query: string; tag: string }
  | { section: "connect" }
  | { section: "access" }
  | { section: "save" };

export function pathOf(route: Route): string {
  if (route.section === "connect") return "/connect";
  if (route.section === "access") return "/access";
  if (route.section === "save") return "/save";
  const params = new URLSearchParams();
  if (route.query) params.set("q", route.query);
  if (route.tag) params.set("tag", route.tag);
  const search = params.toString();
  return `${route.bookmarkId ? `/bookmarks/${encodeURIComponent(route.bookmarkId)}` : "/"}${search ? `?${search}` : ""}`;
}
function routeFromData(data: OpenData): Route {
  if (data.section === "connect" || data.section === "access" || data.section === "save") return { section: data.section };
  return { section: "list", bookmarkId: data.bookmarkId, query: data.query, tag: data.tag };
}

interface Nav {
  route: Route;
  navigate(next: Route, options?: { silent?: boolean }): void;
  data: OpenData;
}
const NavContext = createContext<Nav | null>(null);
export function useNav(): Nav {
  const value = useContext(NavContext);
  if (!value) throw new Error("useNav needs BookmarksApp");
  return value;
}

export function BookmarksApp() {
  const app = useRiApp<OpenData>();
  const data = app.data;
  const [route, setRoute] = useState<Route | null>(() => (data ? routeFromData(data) : null));
  const started = useRef(Boolean(data));
  useEffect(() => {
    installStyles(BOOKMARKS_CSS);
  }, []);
  // The first opener result places the view. Later results only refresh data.
  useEffect(() => {
    if (!data || started.current) return;
    started.current = true;
    setRoute(routeFromData(data));
  }, [data]);

  const navigate = useCallback((next: Route) => {
    setRoute(next);
    app.setLocation(pathOf(next));
  }, [app]);

  useEffect(() => {
    if (!data || !route) return;
    if (route.section === "list") {
      app.context({
        section: "list",
        selected: route.bookmarkId ? [{ type: "bookmark", id: route.bookmarkId }] : [],
        filters: { ...(route.query ? { query: route.query } : {}), ...(route.tag ? { tag: route.tag } : {}) },
      });
    } else app.context({ section: route.section });
  }, [route, Boolean(data)]);

  const nav = useMemo<Nav | null>(() => (data && route ? { route, navigate, data } : null), [route, navigate, data]);
  if (!nav) return <AppFrame><div className="ri-shell"><LoadingState label="Opening Bookmarks" /></div></AppFrame>;
  return (
    <NavContext.Provider value={nav}>
      <AppFrame>
        {nav.route.section === "access" ? <AccessScreen /> : nav.route.section === "connect" ? <ConnectScreen /> : nav.route.section === "save" ? <SaveScreen /> : <ListScreen />}
      </AppFrame>
    </NavContext.Provider>
  );
}

export function MainTabs({ value }: { value: "list" | "connect" }) {
  const { navigate, data } = useNav();
  if (!data.owner) return null;
  return (
    <SectionTabs
      label="Bookmarks sections"
      panelId="bm-main"
      value={value}
      onChange={(id) => navigate(id === "connect" ? { section: "connect" } : { section: "list", bookmarkId: null, query: "", tag: "" })}
      items={[{ id: "list", label: "Bookmarks" }, { id: "connect", label: "Connect" }]}
    />
  );
}
