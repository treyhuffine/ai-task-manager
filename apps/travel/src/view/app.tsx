/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Travel's view root. The location (section, trip, tab, day, selection and
 * filters) lives in the host URL through setLocation, so reopening returns to
 * the same place. Selection and filters reach the chat as context, never as
 * authority: the backend re-resolves them under the chat's own access.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppFrame, installStyles, LoadingState, SectionTabs, useRiApp } from "@ri/app-kit/ui";
import { AccessScreen } from "./access.js";
import { AddBookingDialog } from "./add.js";
import { ReviewScreen } from "./review.js";
import { SourcesScreenView } from "./sources.js";
import { TRAVEL_CSS } from "./styles.js";
import { TripScreen } from "./trip.js";
import { TripsScreen } from "./trips.js";
import type { OpenData, Route } from "./types.js";
import { pathOf, routeFromData } from "./util.js";

interface Nav {
  route: Route;
  navigate(next: Route): void;
  /** Open the add-booking dialog, optionally for a trip. */
  addBooking(tripId?: string | null): void;
  /** Record revisions the person is looking at, for the chat context. */
  setRevisions(revisions: Record<string, number>): void;
  data: OpenData;
}
const NavContext = createContext<Nav | null>(null);
export function useNav(): Nav {
  const value = useContext(NavContext);
  if (!value) throw new Error("useNav needs TravelApp");
  return value;
}

function contextState(route: Route, revisions: Record<string, number>) {
  switch (route.section) {
    case "trip":
      return {
        section: "trip" as const, tripId: route.tripId, tab: route.tab, ...(route.day ? { day: route.day } : {}),
        selected: route.selected ? [{ type: (route.tab === "ideas" ? "idea" : "booking") as "idea" | "booking", id: route.selected }] : [],
        filters: { status: route.status, ...(route.q ? { query: route.q } : {}) },
        revisions,
      };
    case "review": return { section: "review" as const, ...(route.tripId ? { tripId: route.tripId } : {}) };
    case "sources": return { section: "sources" as const };
    case "access": return { section: "access" as const };
    default: return { section: "trips" as const };
  }
}

export function TravelApp() {
  const app = useRiApp<OpenData>();
  const data = app.data;
  const [route, setRoute] = useState<Route>(() => routeFromData(data));
  const [adding, setAdding] = useState<{ tripId: string | null } | null>(null);
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  // Paths this view set itself, plus the path it opened at. The host re-runs the
  // opener with the opening path after writes, which is a refresh, not navigation.
  const emitted = useRef(new Set<string>(data ? [data.path] : []));
  const started = useRef(Boolean(data));
  const remembered = useRef<string | null>(data?.tripId ?? null);
  useEffect(() => {
    installStyles(TRAVEL_CSS);
  }, []);
  // The first opener result places the view. Later results only refresh data,
  // unless the host opened a path this view did not set itself.
  useEffect(() => {
    if (!data) return;
    if (!started.current) {
      started.current = true;
      emitted.current.add(data.path);
      setRoute(routeFromData(data));
      return;
    }
    if (!emitted.current.has(data.path) && data.path !== pathOf(route)) {
      const next = routeFromData(data);
      if (pathOf(next) !== pathOf(route)) setRoute(next);
    }
    // Only a new path matters here, not each refresh.
  }, [data?.path]);

  const navigate = useCallback((next: Route) => {
    setRoute(next);
    const path = pathOf(next);
    emitted.current.add(path);
    if (emitted.current.size > 200) emitted.current = new Set([path, data?.path ?? path]);
    app.setLocation(path);
    // Remember the trip once per trip, not on every day or tab change.
    if (next.section === "trip" && data?.owner && remembered.current !== next.tripId) {
      remembered.current = next.tripId;
      void app.call("remember_view", { lastTripId: next.tripId }).catch(() => undefined);
    }
  }, [app, data?.owner]);

  useEffect(() => {
    if (data) app.context(contextState(route, revisions));
  }, [route, revisions, Boolean(data)]);

  const nav = useMemo<Nav | null>(() => (data ? { route, navigate, addBooking: (tripId) => setAdding({ tripId: tripId ?? null }), setRevisions, data } : null), [route, navigate, data]);
  if (!data || !nav) return <AppFrame><div className="ri-shell"><LoadingState label="Opening Travel" /></div></AppFrame>;
  let screen: ReactNode;
  if (data.section === "access" || route.section === "access") screen = <AccessScreen />;
  else if (route.section === "trip") screen = <TripScreen key={route.tripId} />;
  else if (route.section === "review") screen = <ReviewScreen />;
  else if (route.section === "sources") screen = <SourcesScreenView />;
  else screen = <TripsScreen />;
  return (
    <NavContext.Provider value={nav}>
      <AppFrame>{screen}</AppFrame>
      <AddBookingDialog
        open={Boolean(adding)}
        tripId={adding?.tripId ?? null}
        onClose={() => setAdding(null)}
        onApplied={(tripId) => {
          setAdding(null);
          if (tripId) navigate({ section: "trip", tripId, tab: "itinerary", day: null, selected: null, status: "all", q: "" });
        }}
      />
    </NavContext.Provider>
  );
}

/** Trips, Review and Sources: the app's top-level sections. */
export function MainTabs({ value }: { value: "trips" | "review" | "sources" }) {
  const { navigate, data } = useNav();
  return (
    <SectionTabs
      label="Travel sections"
      panelId="travel-main"
      value={value}
      onChange={(id) => navigate(id === "review" ? { section: "review", tripId: null } : { section: id as "trips" | "sources" })}
      items={[
        { id: "trips", label: "Trips" },
        { id: "review", label: "Review", badge: data.setup.reviewOpen || undefined },
        ...(data.owner ? [{ id: "sources", label: "Sources" }] : []),
      ]}
    />
  );
}
