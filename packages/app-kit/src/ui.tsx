/**
 * `@ri/app-kit/ui`: neutral, accessible React building blocks for included
 * app views (Travel, Job Search, People). Browser only. See README "UI kit".
 */
export const UI_KIT_VERSION = 1;

// Styles
export { baseStyles, installStyles } from "./ui/styles.js";

// Connection and data
export {
  RiAppProvider,
  useRiApp,
  useOptionalRiApp,
  createMemoryClient,
  createCoalescer,
  chatIntentUrl,
  locationIntentUrl,
  directionsUrl,
  downloadContents,
  assertHttpsUrl,
  HOST_PATHS,
  MAX_PROMPT_LENGTH,
  MAX_CONTEXT_BYTES,
} from "./ui/app.js";
export type {
  RiApp,
  RiAppClient,
  RiAppProviderProps,
  Theme,
  SelectedFile,
  DownloadRequest,
  DownloadContent,
  MemoryClient,
  MemoryClientOptions,
  MemoryCall,
  CoalescerOptions,
} from "./ui/app.js";
export { useQuery, useMutation } from "./ui/hooks.js";
export type { QueryResult, MutationResult } from "./ui/hooks.js";
export { AppFrame, useAppLayout, useAppWidth, useLayout, useElementWidth, layoutForWidth, LAYOUT_BREAKPOINTS } from "./ui/layout.js";
export type { AppLayout, AppFrameProps } from "./ui/layout.js";
export { LiveRegion, useAnnounce } from "./ui/announce.js";
export type { Announce, AnnounceOptions } from "./ui/announce.js";

// Layout and navigation
export { AppShell, SectionTabs, SectionPanel, sectionTabId, Toolbar, SearchField, SegmentedControl, FilterChips } from "./ui/navigation.js";
export type { AppShellProps, SectionTabItem, SectionTabsProps, SearchFieldProps, SegmentedOption, FilterChipItem } from "./ui/navigation.js";
export { SplitView, Inspector, useSplitMode } from "./ui/split-view.js";
export type { SplitViewProps, InspectorProps } from "./ui/split-view.js";

// Content
export { Button, ButtonRow } from "./ui/button.js";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./ui/button.js";
export { StatusLabel, Notice, EmptyState, LoadingState, ErrorState, InlineError, ToneIcon } from "./ui/feedback.js";
export type { Tone, NoticeProps, EmptyStateProps } from "./ui/feedback.js";
export { KeyValueList, DataTable, Timeline, SourceLine, Avatar, AvatarLabel } from "./ui/data-display.js";
export type { KeyValueItem, DataColumn, DataTableProps, DataTableSort, TimelineItem, TimelineProps, SourceLineProps } from "./ui/data-display.js";
export { Menu } from "./ui/menu.js";
export type { MenuItem, MenuProps } from "./ui/menu.js";

// Forms and dialogs
export { Dialog } from "./ui/dialog.js";
export type { DialogProps } from "./ui/dialog.js";
export { Field, useField, TextInput, TextArea, Select, Checkbox, RadioGroup, DateInput, MoneyInput } from "./ui/forms.js";
export type { FieldProps, TextInputProps, TextAreaProps, SelectProps, SelectOption, CheckboxProps, RadioOption, DateInputProps, MoneyInputProps, MoneyValue } from "./ui/forms.js";

// Ri workflow composites
export { AskRiButton, FollowUpDialog, ConflictNotice, ReviewCompare, ShareScopeChooser } from "./ui/workflow.js";
export type { AskRiButtonProps, FollowUpDialogProps, CreatedFollowUp, ConflictField, ConflictNoticeProps, CompareRow, ReviewCompareProps, ShareSource, ShareOperation, ShareScopeChooserProps } from "./ui/workflow.js";
export { SourcesScreen, sourceStatusLabel } from "./ui/sources-screen.js";
export type { SourcesScreenProps, SourceAccount, SourceImport, SourceShare, SourceStatus, HistoryDays } from "./ui/sources-screen.js";

// Formatting
export { formatDate, formatDateRange, formatInstant, relativeDay, formatMoney, parseMoneyInput, minorToDecimal, currencyDigits, isCurrencyCode, plural, initialsFor, shortDateLabel } from "./ui/format.js";
export type { MoneyParse } from "./ui/format.js";

// Icons for app chrome. Each is decorative and needs adjacent text.
export {
  CheckIcon,
  WarningIcon,
  DangerIcon,
  InfoIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  SearchIcon,
  ExternalIcon,
  DocumentIcon,
} from "./ui/icons.js";

// A living reference of every component with fictional records.
export { UiGallery, createGalleryClient } from "./ui/gallery.js";
export type { UiGalleryProps, GalleryPage } from "./ui/gallery.js";
