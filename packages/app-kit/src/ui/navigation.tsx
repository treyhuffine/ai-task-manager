import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AppFrame, useInsideAppFrame } from "./layout.js";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "./icons.js";
import { cx } from "./util.js";

export interface AppShellProps {
  /** Small label above the title, usually the app name. */
  eyebrow?: ReactNode;
  /** The one page title. */
  title: ReactNode;
  /** One short line of context, such as dates or a count. */
  context?: ReactNode;
  /** The single primary action. */
  primaryAction?: ReactNode;
  /** Secondary actions shown before the primary action, such as Ask Ri. */
  secondaryActions?: ReactNode;
  /** Section navigation, usually `SectionTabs`. */
  tabs?: ReactNode;
  /** One attention banner shown above the working view. */
  notice?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/**
 * The page frame for an app view: one title, a context line, one primary
 * action, optional section tabs and notice, then the working view. Wraps
 * itself in an `AppFrame` when none is above it.
 */
export function AppShell(props: AppShellProps) {
  const framed = useInsideAppFrame();
  const shell = <ShellBody {...props} />;
  return framed ? shell : <AppFrame>{shell}</AppFrame>;
}
function ShellBody({ eyebrow, title, context, primaryAction, secondaryActions, tabs, notice, children, className }: AppShellProps) {
  return (
    <main className={cx("ri-shell", className)}>
      <div className="ri-shell__header">
        <div className="ri-shell__heading">
          {eyebrow && <p className="ri-eyebrow">{eyebrow}</p>}
          <h1 className="ri-title">{title}</h1>
          {context && <p className="ri-context">{context}</p>}
        </div>
        {(primaryAction || secondaryActions) && (
          <div className="ri-shell__actions">
            {secondaryActions}
            {primaryAction}
          </div>
        )}
      </div>
      {tabs && <div className="ri-shell__tabs">{tabs}</div>}
      {notice && <div className="ri-shell__notice">{notice}</div>}
      <div className="ri-shell__body">{children}</div>
    </main>
  );
}

export interface SectionTabItem { id: string; label: ReactNode; badge?: ReactNode }
export interface SectionTabsProps {
  items: SectionTabItem[];
  value: string;
  onChange(id: string): void;
  /** Accessible name for the tab list, such as "Trip sections". */
  label?: string;
  /** Pair with `SectionPanel panelId` to connect the tabs to their panel. */
  panelId?: string;
  className?: string;
}

/** The id of the tab for an item, matching `SectionPanel`. */
export function sectionTabId(panelId: string, id: string): string {
  return `${panelId}-tab-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/**
 * Section navigation as an ARIA tab list. Arrow keys, Home and End move
 * between tabs and select them. When the tabs do not fit, the row scrolls
 * with a fade and small scroll buttons, and the focused tab scrolls into view.
 */
export function SectionTabs({ items, value, onChange, label = "Sections", panelId, className }: SectionTabsProps) {
  const fallbackId = useId();
  const base = panelId ?? `ri-tabs${fallbackId.replace(/:/g, "")}`;
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const start = list.scrollLeft > 2;
    const end = list.scrollLeft + list.clientWidth < list.scrollWidth - 2;
    setOverflow((current) => (current.start === start && current.end === end ? current : { start, end }));
  }, []);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    measure();
    list.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(list);
    return () => {
      list.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [measure, items.length]);
  useEffect(() => {
    // Bring the selected tab into the strip's own scroll area. Never scroll the page.
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !active) return;
    const left = active.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + active.offsetWidth > list.scrollLeft + list.clientWidth)
      list.scrollTo({ left: Math.max(0, left - 16) });
  }, [value]);

  const select = (index: number) => {
    const item = items[(index + items.length) % items.length];
    if (!item) return;
    onChange(item.id);
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(sectionTabId(base, item.id))}`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === value);
    const keys: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: items.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    select(keys[event.key]);
  };
  const scrollBy = (direction: 1 | -1) => {
    const list = listRef.current;
    list?.scrollBy?.({ left: direction * Math.max(120, list.clientWidth * 0.6), behavior: "smooth" });
  };

  return (
    <div ref={rootRef} className={cx("ri-tabs", className)} data-overflow-start={overflow.start} data-overflow-end={overflow.end}>
      <div ref={listRef} className="ri-tabs__list" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              id={sectionTabId(base, item.id)}
              type="button"
              role="tab"
              className="ri-tab"
              aria-selected={selected}
              aria-controls={panelId && selected ? panelId : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.id)}
            >
              {item.label}
              {item.badge !== undefined && item.badge !== null && item.badge !== false && <span className="ri-tab__badge">{item.badge}</span>}
            </button>
          );
        })}
      </div>
      {/* Pointer helpers only. Keyboard users move with arrow keys and the focused tab scrolls into view. */}
      <button type="button" className="ri-tabs__scroll ri-tabs__scroll--start" tabIndex={-1} aria-hidden="true" onClick={() => scrollBy(-1)}>
        <ChevronLeftIcon />
      </button>
      <button type="button" className="ri-tabs__scroll ri-tabs__scroll--end" tabIndex={-1} aria-hidden="true" onClick={() => scrollBy(1)}>
        <ChevronRightIcon />
      </button>
    </div>
  );
}

/** The tab panel for `SectionTabs` with the same `panelId`. */
export function SectionPanel({ panelId, value, children, className }: { panelId: string; value: string; children?: ReactNode; className?: string }) {
  return (
    <div id={panelId} role="tabpanel" aria-labelledby={sectionTabId(panelId, value)} className={className} tabIndex={-1}>
      {children}
    </div>
  );
}

/** A wrapping row of view controls. `end` content is pushed to the trailing edge. */
export function Toolbar({ children, end, label, className }: { children?: ReactNode; end?: ReactNode; label?: string; className?: string }) {
  return (
    <div className={cx("ri-toolbar", className)} role={label ? "group" : undefined} aria-label={label}>
      {children}
      {end && <div className="ri-toolbar__end">{end}</div>}
    </div>
  );
}

export interface SearchFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  /** Keep the label for assistive technology only. */
  hideLabel?: boolean;
  className?: string;
  id?: string;
}
/** A labeled search box. */
export function SearchField({ label, value, onChange, placeholder, hideLabel, className, id }: SearchFieldProps) {
  const generated = useId();
  const inputId = id ?? `ri-search${generated.replace(/:/g, "")}`;
  return (
    <div className={cx("ri-search", className)}>
      <label htmlFor={inputId} className={hideLabel ? "ri-sr-only" : "ri-search__label"}>{label}</label>
      <div className="ri-search__box">
        <SearchIcon />
        <input id={inputId} type="search" value={value} placeholder={placeholder} autoComplete="off" spellCheck={false} onChange={(event) => onChange(event.target.value)} />
      </div>
    </div>
  );
}

export interface SegmentedOption { id: string; label: ReactNode }
/** A single choice between a few views, such as Board and Table. Arrow keys move the choice. */
export function SegmentedControl({ label, options, value, onChange, className }: { label: string; options: SegmentedOption[]; value: string; onChange(id: string): void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex((option) => option.id === value);
    const keys: Record<string, number> = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: options.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = options[(keys[event.key] + options.length) % options.length];
    if (!next) return;
    onChange(next.id);
    const buttons = ref.current?.querySelectorAll<HTMLElement>('[role="radio"]');
    buttons?.[options.indexOf(next)]?.focus();
  };
  return (
    <div ref={ref} className={cx("ri-segmented", className)} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option) => {
        const checked = option.id === value;
        return (
          <button key={option.id} type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1} className="ri-segmented__option" onClick={() => onChange(option.id)}>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface FilterChipItem { id: string; label: ReactNode; count?: number }
/**
 * Toggle filters as pressed buttons. Pressed chips show a check mark as well
 * as a filled style. Shows a Clear filters link while any filter is on.
 */
export function FilterChips({ label, items, value, onChange, clearLabel = "Clear filters", className }: { label: string; items: FilterChipItem[]; value: string[]; onChange(next: string[]): void; clearLabel?: string; className?: string }) {
  const active = new Set(value);
  return (
    <div className={cx("ri-chips", className)} role="group" aria-label={label}>
      {items.map((item) => {
        const pressed = active.has(item.id);
        return (
          <button
            key={item.id}
            type="button"
            className="ri-chip"
            aria-pressed={pressed}
            onClick={() => onChange(pressed ? value.filter((id) => id !== item.id) : [...value, item.id])}
          >
            <CheckIcon className="ri-chip__check" width={12} height={12} />
            <span>{item.label}</span>
            {item.count !== undefined && <span className="ri-chip__count">{item.count}</span>}
          </button>
        );
      })}
      {value.length > 0 && (
        <button type="button" className="ri-button ri-button--link ri-button--sm" onClick={() => onChange([])}>
          {clearLabel}
        </button>
      )}
    </div>
  );
}
