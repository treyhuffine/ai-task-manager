/**
 * Small purpose-describing shapes drawn inline, since the view sandbox loads
 * no icon library or external asset. Every icon is decorative: the element it
 * sits in carries the text that names its meaning.
 */
import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;
const svg = (props: IconProps) => ({
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
  ...props,
});

/** The inner mark of a filled shape uses the surface color. */
const knockout = { stroke: "var(--ri-surface, #fff)" };

/** Completed or confirmed. */
export const CheckIcon = (props: IconProps) => (
  <svg {...svg(props)}><path d="M3.2 8.4 6.4 11.4 12.8 4.6" /></svg>
);
/** Needs attention: a triangle with a mark. */
export const WarningIcon = (props: IconProps) => (
  <svg {...svg(props)}><path d="M8 2.2 14.2 13H1.8Z" fill="currentColor" stroke="currentColor" strokeWidth={1.2} /><path d="M8 6.2v3.1M8 11.1v.1" style={knockout} strokeWidth={1.5} /></svg>
);
/** Failed or blocked: a filled square with a cross. */
export const DangerIcon = (props: IconProps) => (
  <svg {...svg(props)}><rect x="2" y="2" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" /><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" style={knockout} strokeWidth={1.5} /></svg>
);
/** Information: a filled circle with a mark. */
export const InfoIcon = (props: IconProps) => (
  <svg {...svg(props)}><circle cx="8" cy="8" r="6.4" fill="currentColor" stroke="none" /><path d="M8 7.2v4M8 4.9v.1" style={knockout} strokeWidth={1.5} /></svg>
);
/** A neutral state: an open circle. */
export const NeutralIcon = (props: IconProps) => (
  <svg {...svg(props)}><circle cx="8" cy="8" r="5" strokeWidth={1.8} /></svg>
);
/** A success state: a filled circle with a check. */
export const SuccessIcon = (props: IconProps) => (
  <svg {...svg(props)}><circle cx="8" cy="8" r="6.4" fill="currentColor" stroke="none" /><path d="M5.1 8.2 7.1 10.1 10.9 6" style={knockout} strokeWidth={1.6} /></svg>
);
/** Opens a list of choices. */
export const ChevronDownIcon = (props: IconProps) => (
  <svg {...svg(props)}><path d="M4 6l4 4 4-4" /></svg>
);
/** Goes back to the previous screen. */
export const ChevronLeftIcon = (props: IconProps) => (
  <svg {...svg(props)}><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
);
/** Scrolls forward. */
export const ChevronRightIcon = (props: IconProps) => (
  <svg {...svg(props)}><path d="M6 3.5 10.5 8 6 12.5" /></svg>
);
/** Closes a panel or dialog. */
export const CloseIcon = (props: IconProps) => (
  <svg {...svg(props)}><path d="M4 4l8 8M12 4l-8 8" /></svg>
);
/** Searches the current list. */
export const SearchIcon = (props: IconProps) => (
  <svg {...svg(props)}><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2 13.5 13.5" /></svg>
);
/** Opens outside this app, such as a source or a map. */
export const ExternalIcon = (props: IconProps) => (
  <svg {...svg(props)}><path d="M6.5 3.5H3.5v9h9v-3M9 3h4v4M13 3 7.5 8.5" /></svg>
);
/** A source document. */
export const DocumentIcon = (props: IconProps) => (
  <svg {...svg(props)}><path d="M4 2h5.5L12.5 5v9H4Z" /><path d="M9.5 2v3h3" /></svg>
);
/** A source that is no longer available: a dashed document. */
export const MissingDocumentIcon = (props: IconProps) => (
  <svg {...svg(props)}><path d="M4 2h5.5L12.5 5v9H4Z" strokeDasharray="2 1.6" /></svg>
);
/** Sort direction for a table column. */
export const SortIcon = ({ direction, ...props }: IconProps & { direction: "ascending" | "descending" | "none" }) => (
  <svg {...svg(props)}>
    {direction !== "descending" && <path d="M5 6.5 8 3.5l3 3" opacity={direction === "none" ? 0.45 : 1} />}
    {direction !== "ascending" && <path d="M5 9.5l3 3 3-3" opacity={direction === "none" ? 0.45 : 1} />}
  </svg>
);
