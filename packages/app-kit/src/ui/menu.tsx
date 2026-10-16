import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon } from "./icons.js";
import { cx } from "./util.js";
import type { ButtonVariant, ButtonSize } from "./button.js";

export interface MenuItem { id: string; label: ReactNode; disabled?: boolean; hint?: ReactNode; textValue?: string }
export interface MenuProps {
  /** Text of the trigger button, such as "Move to stage". */
  label: ReactNode;
  /** Accessible name when the label is not plain text. */
  ariaLabel?: string;
  items: MenuItem[];
  onSelect(id: string): void;
  /** Marks the current choice with a check, such as the current stage. */
  selectedId?: string | null;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Open toward the end edge. Defaults to automatic placement. */
  align?: "start" | "end";
  className?: string;
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * A button that opens a menu of choices, for keyboard alternatives to drag
 * and drop such as "Move to stage". Arrow keys, Home, End and typing a letter
 * move between items. Escape or Tab closes, and focus returns to the button.
 */
export function Menu({ label, ariaLabel, items, onSelect, selectedId, variant = "secondary", size = "md", align, className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<{ align: "start" | "end"; side: "bottom" | "top" }>({ align: align ?? "start", side: "bottom" });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<"first" | "last" | "selected">("selected");
  const typeahead = useRef({ text: "", at: 0 });
  const menuId = useId();
  const triggerId = useId();
  const radio = selectedId !== undefined;

  const itemElements = () => Array.from(popupRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
  const focusItem = (index: number) => {
    const elements = itemElements();
    if (!elements.length) return;
    elements[(index + elements.length) % elements.length]?.focus();
  };
  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    const popup = popupRef.current, trigger = triggerRef.current;
    if (popup && trigger) {
      const frame = document.documentElement.clientWidth;
      const triggerRect = trigger.getBoundingClientRect();
      const width = popup.offsetWidth, height = popup.offsetHeight;
      const nextAlign = align ?? (triggerRect.left + width > frame - 8 && triggerRect.right - width >= 8 ? "end" : "start");
      const below = window.innerHeight - triggerRect.bottom, above = triggerRect.top;
      const side = below < height + 8 && above > below ? "top" : "bottom";
      setPlacement((current) => (current.align === nextAlign && current.side === side ? current : { align: nextAlign, side }));
    }
    const elements = itemElements();
    const enabled = elements.map((element, index) => ({ element, index })).filter(({ element }) => element.getAttribute("aria-disabled") !== "true");
    const selectedIndex = items.findIndex((item) => item.id === selectedId);
    const target =
      initialFocus.current === "last" ? enabled[enabled.length - 1]?.index :
      initialFocus.current === "selected" && selectedIndex >= 0 ? selectedIndex : enabled[0]?.index;
    focusItem(target ?? 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      initialFocus.current = event.key === "ArrowUp" ? "last" : "selected";
      setOpen(true);
    }
  };
  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    close(true);
    onSelect(item.id);
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const elements = itemElements();
    const index = elements.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); focusItem(index + 1); return;
      case "ArrowUp": event.preventDefault(); focusItem(index - 1); return;
      case "Home": event.preventDefault(); focusItem(0); return;
      case "End": event.preventDefault(); focusItem(elements.length - 1); return;
      case "Escape": event.preventDefault(); event.stopPropagation(); close(true); return;
      case "Tab": close(false); return;
    }
    if (event.key.length === 1 && /\S/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      typeahead.current = { text: (now - typeahead.current.at < 700 ? typeahead.current.text : "") + event.key.toLowerCase(), at: now };
      const texts = items.map((item) => (item.textValue ?? (typeof item.label === "string" ? item.label : "")).toLowerCase());
      const start = typeahead.current.text.length > 1 ? index : index + 1;
      for (let step = 0; step < items.length; step++) {
        const candidate = (start + step + items.length) % items.length;
        if (texts[candidate].startsWith(typeahead.current.text)) {
          focusItem(candidate);
          break;
        }
      }
    }
  };

  return (
    <div ref={rootRef} className={cx("ri-menu", className)}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={cx("ri-button", `ri-button--${variant}`, size !== "md" && `ri-button--${size}`)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={() => {
          initialFocus.current = "selected";
          setOpen((value) => !value);
        }}
        onKeyDown={onTriggerKeyDown}
      >
        {label}
        <ChevronDownIcon className="ri-menu__chevron" />
      </button>
      {open && (
        <div
          ref={popupRef}
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          className="ri-menu__popup"
          data-align={placement.align}
          data-side={placement.side}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role={radio ? "menuitemradio" : "menuitem"}
              aria-checked={radio ? item.id === selectedId : undefined}
              aria-disabled={item.disabled || undefined}
              tabIndex={-1}
              className="ri-menu__item"
              onClick={() => choose(item)}
            >
              {radio && <CheckIcon className="ri-menu__check" />}
              <span>{item.label}</span>
              {item.hint && <span className="ri-menu__hint">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
