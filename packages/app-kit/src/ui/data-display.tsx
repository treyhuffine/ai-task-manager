import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "./button.js";
import { DocumentIcon, MissingDocumentIcon, SortIcon } from "./icons.js";
import { useAppLayout, useElementWidth } from "./layout.js";
import { formatDate, initialsFor, shortDateLabel } from "./format.js";
import type { Tone } from "./feedback.js";
import { cx, isLocalDateString } from "./util.js";

export interface KeyValueItem { label: ReactNode; value: ReactNode; key?: string }
/** Label and value pairs as a description list. `stacked` puts each value under its label. */
export function KeyValueList({ items, stacked, className, label }: { items: KeyValueItem[]; stacked?: boolean; className?: string; label?: string }) {
  return (
    <dl className={cx("ri-kv", stacked && "ri-kv--stacked", className)} aria-label={label}>
      {items.map((item, index) => (
        <div className="ri-kv__row" key={item.key ?? (typeof item.label === "string" ? item.label : index)}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface DataColumn<T> {
  key: string;
  label: string;
  align?: "start" | "end";
  /** Cell content. Defaults to `row[key]` as text. */
  render?: (row: T) => ReactNode;
  /** Sortable through `sort` and `onSortChange`. */
  sortable?: boolean;
  /** Omit from the narrow row-card rendering. */
  hideInCards?: boolean;
}
export interface DataTableSort { key: string; direction: "ascending" | "descending" }
export interface DataTableProps<T> {
  /** Names the table. Shown above it unless `captionHidden`. */
  caption: string;
  captionHidden?: boolean;
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: keyof T | ((row: T) => string);
  selectedKey?: string | null;
  /** Makes rows selectable with click, Enter or Space. Arrow keys, Home and End move between rows. */
  onSelect?: (key: string, row: T) => void;
  /** Accessible label for a row in the narrow layout. Defaults to the first column's text. */
  rowLabel?: (row: T) => string;
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort) => void;
  /** Shown when there are no rows. */
  empty?: ReactNode;
  /** Keep the first column visible while the table scrolls sideways. */
  stickyFirstColumn?: boolean;
  /** Below this own width, rows render as stacked cards with the same data. Defaults to 560 px. */
  cardBelow?: number;
  /** Force a rendering, for example in a gallery. */
  display?: "auto" | "table" | "cards";
  className?: string;
}

const cellText = (value: unknown): ReactNode => (value === null || value === undefined || value === "" ? "Not provided" : typeof value === "object" ? JSON.stringify(value) : String(value));

/**
 * A semantic table with keyboard row selection. In a narrow container the
 * same rows render as stacked cards, never a miniature desktop table.
 */
export function DataTable<T>({ caption, captionHidden, columns, rows, rowKey, selectedKey, onSelect, rowLabel, sort, onSortChange, empty, stickyFirstColumn, cardBelow = 560, display = "auto", className }: DataTableProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const layout = useAppLayout();
  const cards = display === "cards" || (display === "auto" && (width === null ? layout === "narrow" : width < cardBelow));
  const keyOf = (row: T) => (typeof rowKey === "function" ? rowKey(row) : String(row[rowKey]));
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  const captionId = useId();
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const check = () => setScrolls(element.scrollWidth > element.clientWidth + 1);
    check();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [cards, rows.length, columns.length]);

  const keys = rows.map(keyOf);
  const tabStop = focusKey && keys.includes(focusKey) ? focusKey : selectedKey && keys.includes(selectedKey) ? selectedKey : keys[0];
  const cell = (column: DataColumn<T>, row: T) => (column.render ? column.render(row) : cellText((row as Record<string, unknown>)[column.key]));

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, index: number, row: T) => {
    if (!onSelect || event.target !== event.currentTarget) return;
    let next = -1;
    if (event.key === "ArrowDown") next = Math.min(rows.length - 1, index + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = rows.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(keys[index], row);
      return;
    } else return;
    event.preventDefault();
    setFocusKey(keys[next]);
    bodyRef.current?.querySelectorAll<HTMLElement>("tr")[next]?.focus();
  };

  if (!rows.length && empty)
    return <div ref={ref} className={cx("ri-table-block", className)}>{captionHidden ? <h3 className="ri-sr-only">{caption}</h3> : null}{empty}</div>;

  if (cards) {
    const primary = columns[0];
    const rest = columns.slice(1).filter((column) => !column.hideInCards);
    return (
      <div ref={ref} className={cx("ri-table-block", className)}>
        <h3 id={captionId} className={captionHidden ? "ri-sr-only" : "ri-row-cards__caption ri-h3"}>{caption}</h3>
        <ul className="ri-row-cards" aria-labelledby={captionId}>
          {rows.map((row) => {
            const key = keyOf(row);
            const selected = key === selectedKey;
            const body = (
              <>
                {primary && <span className="ri-row-card__title">{cell(primary, row)}</span>}
                {rest.map((column) => (
                  <span className="ri-row-card__field" key={column.key}>
                    <span className="ri-row-card__label">{column.label}</span>
                    <span className="ri-row-card__value">{cell(column, row)}</span>
                  </span>
                ))}
              </>
            );
            return (
              <li key={key}>
                {onSelect ? (
                  <button type="button" className="ri-row-card" aria-current={selected || undefined} aria-label={rowLabel?.(row)} onClick={() => onSelect(key, row)}>
                    {body}
                  </button>
                ) : (
                  <div className="ri-row-card" aria-current={selected || undefined}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div ref={ref} className={cx("ri-table-block", className)}>
      <div
        ref={scrollRef}
        className="ri-table-wrap"
        role={scrolls ? "region" : undefined}
        aria-labelledby={scrolls ? captionId : undefined}
        tabIndex={scrolls ? 0 : undefined}
      >
        <table className={cx("ri-table", stickyFirstColumn && "ri-table--sticky")}>
          <caption id={captionId} className={captionHidden ? "ri-sr-only" : undefined}>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const direction = sort?.key === column.key ? sort.direction : "none";
                return (
                  <th key={column.key} scope="col" data-align={column.align === "end" ? "end" : undefined} aria-sort={column.sortable && onSortChange ? direction : undefined}>
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        className="ri-table__sort"
                        onClick={() => onSortChange({ key: column.key, direction: direction === "ascending" ? "descending" : "ascending" })}
                      >
                        {column.label}
                        <SortIcon direction={direction} />
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {rows.map((row, index) => {
              const key = keys[index];
              const selected = key === selectedKey;
              return (
                <tr
                  key={key}
                  data-selectable={onSelect ? "true" : undefined}
                  aria-current={selected || undefined}
                  tabIndex={onSelect ? (key === tabStop ? 0 : -1) : undefined}
                  onClick={onSelect ? () => {
                    setFocusKey(key);
                    onSelect(key, row);
                  } : undefined}
                  onFocus={onSelect ? () => setFocusKey(key) : undefined}
                  onKeyDown={onSelect ? (event) => onRowKeyDown(event, index, row) : undefined}
                >
                  {columns.map((column, columnIndex) => {
                    const content = cell(column, row);
                    const align = column.align === "end" ? "end" : undefined;
                    return columnIndex === 0 ? (
                      <th key={column.key} scope="row" data-align={align} className="ri-table__primary">{content}</th>
                    ) : (
                      <td key={column.key} data-align={align}>{content}</td>
                    );
                  })}
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={columns.length} className="ri-table-empty">No records to show</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface TimelineItem {
  id: string;
  /** A local date such as "2026-10-12" is formatted and marked up as a time element. Other values show as given. */
  date: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  body?: ReactNode;
  /** Source text shown on request with a real expand button. */
  excerpt?: ReactNode;
  actions?: ReactNode;
  tone?: Tone;
}
export interface TimelineProps {
  items: TimelineItem[];
  label?: string;
  /** Rows as cards, as in an itinerary. Defaults to plain rows. */
  variant?: "plain" | "cards";
  selectedId?: string | null;
  /** Makes each title a button that selects the item. */
  onSelect?: (id: string) => void;
  showExcerptLabel?: string;
  hideExcerptLabel?: string;
  className?: string;
}
/** A chronological ordered list. */
export function Timeline({ items, label, variant = "plain", selectedId, onSelect, showExcerptLabel = "Show excerpt", hideExcerptLabel = "Hide excerpt", className }: TimelineProps) {
  return (
    <ol className={cx("ri-timeline", variant === "cards" && "ri-timeline--cards", className)} aria-label={label}>
      {items.map((item) => (
        <TimelineRow key={item.id} item={item} selected={item.id === selectedId} onSelect={onSelect} showLabel={showExcerptLabel} hideLabel={hideExcerptLabel} />
      ))}
    </ol>
  );
}
function TimelineRow({ item, selected, onSelect, showLabel, hideLabel }: { item: TimelineItem; selected: boolean; onSelect?: (id: string) => void; showLabel: string; hideLabel: string }) {
  const [open, setOpen] = useState(false);
  const excerptId = useId();
  const date = isLocalDateString(item.date) ? <time dateTime={item.date}>{formatDate(item.date, "short")}</time> : item.date;
  return (
    <li className="ri-timeline__item" data-selected={selected || undefined} data-tone={item.tone && item.tone !== "neutral" ? item.tone : undefined}>
      <span className="ri-timeline__date">{date}</span>
      <span className="ri-timeline__marker" aria-hidden="true" />
      <div className="ri-timeline__content">
        {onSelect ? (
          <button type="button" className="ri-timeline__select" aria-current={selected || undefined} onClick={() => onSelect(item.id)}>
            {item.title}
          </button>
        ) : (
          <p className="ri-timeline__title">{item.title}</p>
        )}
        {item.meta && <div className="ri-timeline__meta">{item.meta}</div>}
        {item.body && <div className="ri-timeline__body">{item.body}</div>}
        {item.excerpt && open && <blockquote id={excerptId} className="ri-timeline__excerpt">{item.excerpt}</blockquote>}
        {(item.excerpt || item.actions) && (
          <div className="ri-timeline__actions">
            {item.excerpt && (
              <Button variant="link" size="sm" aria-expanded={open} aria-controls={open ? excerptId : undefined} onClick={() => setOpen((value) => !value)}>
                {open ? hideLabel : showLabel}
              </Button>
            )}
            {item.actions}
          </div>
        )}
      </div>
    </li>
  );
}

export interface SourceLineProps {
  /** What the source is, such as "confirmation email". */
  label: ReactNode;
  /** When the source was observed: a local date or an instant. */
  observedAt?: string | null;
  /** Open the original through the host. Omitted when the source is unavailable. */
  onOpen?: () => void;
  availability?: "available" | "unavailable";
  openLabel?: string;
  /** Time zone for an instant. Defaults to the system zone. */
  zone?: string;
  className?: string;
}
/** Provenance for a fact: "Source: confirmation email · Observed Oct 14 · Open source". */
export function SourceLine({ label, observedAt, onOpen, availability = "available", openLabel = "Open source", zone, className }: SourceLineProps) {
  // "Oct 14" stays on one line.
  const observed = observedAt ? shortDateLabel(observedAt, zone)?.replace(/ /g, "\u00a0") ?? null : null;
  const unavailable = availability === "unavailable";
  // A no-break space keeps each dot with the words before it, so a wrapped line never starts with one.
  const dot = <span className="ri-source__sep" aria-hidden="true">{"\u00a0· "}</span>;
  return (
    <p className={cx("ri-source", unavailable && "ri-source--unavailable", className)}>
      <span className="ri-source__text">
        {unavailable ? <MissingDocumentIcon className="ri-source__marker" /> : <DocumentIcon className="ri-source__marker" />}
        {unavailable ? (
          <>
            <span className="ri-source__state">Source unavailable</span>
            {dot}
            {label}
          </>
        ) : (
          <>Source: {label}</>
        )}
        {observed && (
          <>
            {dot}
            Observed {observed}
          </>
        )}
      </span>
      {!unavailable && onOpen && (
        <>
          {" "}
          <Button variant="link" size="sm" onClick={onOpen}>{openLabel}</Button>
        </>
      )}
    </p>
  );
}

/**
 * Neutral initials for a person or company. Decorative by default because the
 * name sits beside it. Pass `label` when the avatar stands alone.
 */
export function Avatar({ name, size = "md", label, className }: { name: string; size?: "sm" | "md" | "lg"; label?: boolean; className?: string }) {
  return (
    <span className={cx("ri-avatar", size !== "md" && `ri-avatar--${size}`, className)} role={label ? "img" : undefined} aria-label={label ? name : undefined} aria-hidden={label ? undefined : true}>
      {initialsFor(name)}
    </span>
  );
}

/** Neutral initials beside a name and an optional detail line, for directory rows. */
export function AvatarLabel({ name, detail, size = "sm" }: { name: string; detail?: ReactNode; size?: "sm" | "md" }) {
  return (
    <span className="ri-avatar-label">
      <Avatar name={name} size={size} />
      <span className="ri-avatar-label__text">
        <span className="ri-avatar-label__name">{name}</span>
        {detail && <span className="ri-avatar-label__detail">{detail}</span>}
      </span>
    </span>
  );
}
