/**
 * Container-measured layout. The app frame can be a 360 px companion pane or
 * a 1,500 px page, so components respond to the width they are given, never
 * the viewport. Breakpoints: narrow below 700 px (one content column), medium
 * from 700 to 1,149 px, wide from 1,150 px.
 */
import { createContext, useContext, useInsertionEffect, useLayoutEffect, useEffect, useRef, useState, type ReactNode, type RefObject, type HTMLAttributes } from "react";
import { installStyles } from "./styles.js";
import { cx } from "./util.js";

export type AppLayout = "narrow" | "medium" | "wide";
export const LAYOUT_BREAKPOINTS = { medium: 700, wide: 1150 } as const;

/** The layout for a measured width in CSS pixels. */
export function layoutForWidth(width: number): AppLayout {
  if (width < LAYOUT_BREAKPOINTS.medium) return "narrow";
  if (width < LAYOUT_BREAKPOINTS.wide) return "medium";
  return "wide";
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The current inline size of an element, measured with ResizeObserver.
 * Returns `null` before the first measurement, including during server render.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = () => setWidth(Math.round(element.getBoundingClientRect().width));
    read();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const size = entry?.borderBoxSize?.[0]?.inlineSize ?? entry?.contentRect.width;
      if (size !== undefined) setWidth(Math.round(size));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** The layout of an element measured by its own width. */
export function useLayout(ref: RefObject<HTMLElement | null>, fallback: AppLayout = "wide"): AppLayout {
  const width = useElementWidth(ref);
  return width === null ? fallback : layoutForWidth(width);
}

interface LayoutContextValue { layout: AppLayout; width: number | null; framed: boolean }
const LayoutContext = createContext<LayoutContextValue>({ layout: "wide", width: null, framed: false });

/** The layout of the nearest `AppFrame`, or `wide` outside one. */
export function useAppLayout(): AppLayout {
  return useContext(LayoutContext).layout;
}
/** The measured width of the nearest `AppFrame`, or null before measurement. */
export function useAppWidth(): number | null {
  return useContext(LayoutContext).width;
}
export function useInsideAppFrame(): boolean {
  return useContext(LayoutContext).framed;
}

export interface AppFrameProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  /** Layout before the first measurement, such as during server render. */
  initialLayout?: AppLayout;
}

/**
 * The root of an app view. It installs the kit styles, becomes the container
 * for container queries, measures itself and provides the layout to children
 * through `useAppLayout()`. It also exposes `data-layout` for app CSS.
 */
export function AppFrame({ children, className, initialLayout = "wide", ...rest }: AppFrameProps) {
  useInsertionEffect(() => {
    installStyles();
  }, []);
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const layout = width === null ? initialLayout : layoutForWidth(width);
  return (
    <LayoutContext.Provider value={{ layout, width, framed: true }}>
      <div ref={ref} className={cx("ri-app", className)} data-layout={layout} {...rest}>
        {children}
      </div>
    </LayoutContext.Provider>
  );
}
