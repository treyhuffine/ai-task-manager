'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

/** Hover time before the first tooltip opens. Once one is showing, the next
 *  opens at once (Radix's skip delay), so moving along a toolbar reads it. */
const OPEN_DELAY_MS = 500;

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'CapsLock']);

/** Whether the last input was a key press (`TipProvider` keeps it). */
const LastInputWasKey = createContext<RefObject<boolean> | null>(null);

/**
 * The app-wide tooltip timing, mounted once in the root layout. A `Tip`
 * rendered outside it (a separate React root such as the editor's
 * suggestion popup, or a test) brings its own.
 */
export function TipProvider({ children }: { children: ReactNode }) {
  const lastInputWasKey = useRef(false);
  useEffect(() => {
    // A bare modifier doesn't count: ⌘ on its way to ⌘-Tab would otherwise
    // open a tooltip on whatever had focus when the window comes back.
    const onKey = (e: KeyboardEvent) => {
      if (!MODIFIER_KEYS.has(e.key)) lastInputWasKey.current = true;
    };
    const onPointer = () => {
      lastInputWasKey.current = false;
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);
  return (
    <TooltipProvider delayDuration={OPEN_DELAY_MS}>
      <LastInputWasKey.Provider value={lastInputWasKey}>{children}</LastInputWasKey.Provider>
    </TooltipProvider>
  );
}

type TipProps = Omit<ComponentProps<typeof TooltipPrimitive.Trigger>, 'asChild' | 'children'> & {
  /** What the element does, or why it's unavailable. Empty shows nothing. */
  label: ReactNode;
  /** A keyboard shortcut's display string, e.g. `HOTKEYS.toggleTools.label`. */
  shortcut?: string;
  side?: ComponentProps<typeof TooltipContent>['side'];
  align?: ComponentProps<typeof TooltipContent>['align'];
  children: ReactElement;
};

/**
 * The app's tooltip, used in place of the browser's `title` attribute (lint
 * rejects `title` on DOM elements). It wraps one element and adds no DOM of
 * its own: the element becomes the trigger, so layout and styles stay as
 * they were.
 *
 * - Opens on hover after the app-wide delay (`TipProvider`) and on focus
 *   from the keyboard. Not on the focus a click, a dialog's autofocus or a
 *   menu closed by a click hands back.
 * - Closes on press and stays closed while the element's own menu or
 *   popover is open (`aria-expanded`).
 * - An empty `label` (`undefined`, `null`, `false`, `''`) shows nothing, so a
 *   conditional label stays one expression and the element never remounts
 *   when it flips.
 * - Works on a disabled button, so the label can say why it's off. Browsers
 *   still send disabled buttons pointer events, unless the button has
 *   `pointer-events-none` (as the shadcn `Button` does when disabled).
 * - Forwards props and ref, so it can sit inside another `asChild` trigger:
 *   `<DropdownMenuTrigger asChild><Tip label="…"><button /></Tip>`. Put it
 *   inside such a trigger, never around one, or the tooltip's `data-state`
 *   replaces the menu's.
 * - The label describes the element, it doesn't name it. An icon-only button
 *   still needs its own `aria-label`.
 */
export function Tip(props: TipProps) {
  if (useContext(LastInputWasKey)) return <TipBody {...props} />;
  return (
    <TipProvider>
      <TipBody {...props} />
    </TipProvider>
  );
}

function TipBody({ label, shortcut, side, align, children, ref, onFocus, onPointerDown, ...triggerProps }: TipProps) {
  const lastInputWasKey = useContext(LastInputWasKey);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const hasLabel = label !== undefined && label !== null && label !== false && label !== '';
  return (
    <Tooltip
      open={hasLabel && open}
      onOpenChange={(next) => setOpen(next && trigger.current?.getAttribute('aria-expanded') !== 'true')}
    >
      {/* The primitive, not the shadcn part: that one stamps its own
          `data-slot` over the element's (a Button's "button"). */}
      <TooltipPrimitive.Trigger
        asChild
        {...triggerProps}
        ref={(el) => {
          trigger.current = el;
          setRef(ref, el);
        }}
        onFocus={(e) => {
          onFocus?.(e);
          // Radix opens on any focus. Preventing the default skips its
          // handler. `:focus-visible` alone isn't enough: browsers set it
          // on the trigger a menu hands focus back to, even after a click.
          if (!(lastInputWasKey?.current && e.currentTarget.matches(':focus-visible'))) e.preventDefault();
        }}
        onPointerDown={(e) => {
          onPointerDown?.(e);
          // Radix closes on press, unless an outer trigger already handled
          // the press: a menu trigger prevents the default as it opens.
          setOpen(false);
        }}
      >
        {children}
      </TooltipPrimitive.Trigger>
      {hasLabel && (
        <TooltipContent side={side} align={align} sideOffset={4} className="whitespace-pre-line wrap-anywhere">
          {label}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </TooltipContent>
      )}
    </Tooltip>
  );
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}
