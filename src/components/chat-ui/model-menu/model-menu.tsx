'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  Loader2,
  ChevronDown,
  ChevronRight,
  MessageSquarePlus,
  Settings2,
  Zap,
} from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import { ModelMenuList } from './model-menu-list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HarnessIcon } from '@/components/settings/harness-connection-ui';
import { Tip } from '@/components/ui/tip';
import { useViewportTier } from '@/hooks/use-viewport-tier';
import type { EffortLevel } from '@/db/types';
import { serviceTierLabel, type ServiceTierOption } from '@/lib/harness/service-tiers';
import type {
  EffortOption,
  ModelOption,
  ProviderId,
} from '@/lib/harness/options';

/** Native tier ids, including provider-advertised future tiers. */
export type SpeedMode = string;
export interface SpeedControl {
  value: SpeedMode | null;
  modes: readonly SpeedMode[];
  options?: readonly ServiceTierOption[];
  onChange: (mode: SpeedMode) => void;
  pending?: boolean;
}

/** Shared by the live composer and the isolated gallery. No saved or runtime state. */
export function ModelMenuContent({
  children,
  effort,
  efforts = [],
  onEffortChange,
  variant,
  speed,
  disabled,
  onManageModels,
  footer,
}: {
  children: ReactNode;
  effort?: EffortLevel | null;
  efforts?: readonly EffortOption[];
  onEffortChange?: (effort: EffortLevel) => void;
  variant?: {
    value: string | null;
    options: NonNullable<ModelOption['variants']>;
    onChange: (id: string) => void;
  };
  speed?: SpeedControl;
  disabled?: boolean;
  onManageModels?: () => void;
  footer?: ReactNode;
}) {
  const [openOption, setOpenOption] = useState<string | null>(null);
  const optionState = (label: string) => ({
    open: openOption === label,
    restoreFocus: openOption === null || openOption === label,
    onOpenChange: (open: boolean) => setOpenOption(current => open ? label : current === label ? null : current),
  });
  const effortLabel =
    efforts.find((option) => option.id === effort)?.label ?? effort ?? 'Choose';
  const variants = variant?.options.filter((option) => !option.disabled) ?? [];
  const showSpeed = speed && (speed.modes.some(mode => mode !== 'default')
    || (speed.value && speed.value !== 'default' && speed.modes.includes('default')));
  return (
    <div className="flex max-h-[min(720px,calc(var(--radix-popover-content-available-height,100dvh)-1rem))] min-h-0 min-w-0 flex-col">
      <Command
        label="Search models"
        className="h-auto min-h-0 flex-1 rounded-none bg-transparent [&_[cmdk-input-wrapper]]:shrink-0"
      >
        <CommandInput
          placeholder="Search models"
          aria-label="Search models"
          className="h-10 text-[12px]"
        />
        <ModelMenuList>
          <CommandEmpty className="px-3 py-6 text-center text-[12px] text-muted-foreground">
            No supported models match.
          </CommandEmpty>
          {children}
        </ModelMenuList>
      </Command>
      <div className="shrink-0 border-t border-border p-1.5">
        {efforts.length > 0 && onEffortChange && (
          <OptionRow
            {...optionState('Effort')}
            label="Effort"
            value={effortLabel}
            selected={effort ?? ''}
            options={efforts.map((option) => ({
              id: option.id,
              label: option.label,
              hint: option.hint,
            }))}
            onChange={(id) => onEffortChange(id as EffortLevel)}
            disabled={disabled}
          />
        )}
        {variant && variants.length > 0 && (
          <OptionRow
            {...optionState('Variant')}
            label="Variant"
            value={
              variants.find((option) => option.id === variant.value)?.name ??
              'Default'
            }
            selected={variant.value ?? ''}
            options={variants.map((option) => ({
              id: option.id,
              label: option.name,
              hint: option.description,
            }))}
            onChange={variant.onChange}
            disabled={disabled}
          />
        )}
        {showSpeed && (
          <OptionRow
            {...optionState('Speed')}
            label="Speed"
            value={speed.pending ? 'Coming soon' : speed.value ? speed.options?.find(option => option.id === speed.value)?.label ?? serviceTierLabel(speed.value) : 'Provider default'}
            selected={speed.value ?? ''}
            options={speed.options ?? speed.modes.map((id) => ({ id, label: serviceTierLabel(id) }))}
            onChange={(id) => speed.onChange(id as SpeedMode)}
            disabled={disabled || speed.pending}
          />
        )}
        {onManageModels && <button
          type="button"
          onClick={onManageModels}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Settings2 size={13} />
          Manage models
          <span className="ml-auto text-[10.5px] text-muted-foreground/70">
            Show or hide
          </span>
        </button>}
      </div>
      {footer && (
        <div className="shrink-0 border-t border-border px-2.5 pb-0.5 pt-2">
          {footer}
        </div>
      )}
    </div>
  );
}

export function ModelMenuItem({
  harness,
  model,
  selected,
  isDefault,
  startsNewChat,
  disabled,
  pending,
  onSelect,
}: {
  harness: ProviderId;
  model: ModelOption;
  selected: boolean;
  isDefault?: boolean;
  startsNewChat?: boolean;
  disabled?: boolean;
  pending?: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={`${harness}:${model.id}`}
      keywords={[model.label, harness, model.id]}
      onSelect={onSelect}
      disabled={disabled || model.availability === 'unavailable'}
      aria-label={`${model.label}${startsNewChat ? ', new chat' : ''}`}
      className="gap-2.5 rounded-md px-2.5 py-2 text-[12px] data-[selected=true]:bg-muted/70"
    >
      <HarnessIcon id={harness} size={15} className="text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{model.label}</span>
        {model.custom && (
          <span className="block truncate font-mono text-[10px] text-muted-foreground">
            {model.id}
          </span>
        )}
      </span>
      {isDefault && (
        <span className="text-[10px] text-muted-foreground">default</span>
      )}
      {pending ? (
        <Loader2
          size={13}
          className="animate-spin"
          aria-label="Selecting model"
        />
      ) : model.availability === 'unavailable' ? (
        <span className="text-[10px] text-muted-foreground">Unavailable</span>
      ) : selected ? (
        <Check size={14} />
      ) : startsNewChat ? (
        <Tip label="Starts a fresh chat. Your current chat stays in history.">
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <MessageSquarePlus size={12} />
            new chat
          </span>
        </Tip>
      ) : null}
    </CommandItem>
  );
}

export function ModelMenuLabel({
  model,
  effort,
  speed,
}: {
  model: string;
  effort?: string | null;
  speed?: SpeedMode;
}) {
  return (
    <>
      <span className="max-w-40 truncate">{model}</span>
      {effort && <span className="text-muted-foreground/70">{effort}</span>}
      {speed && speed !== 'default' && (
        <Zap
          size={11}
          className="text-amber-500"
          aria-label={serviceTierLabel(speed)}
        />
      )}
      <ChevronDown size={11} className="shrink-0 text-muted-foreground/60" />
    </>
  );
}

function OptionRow({
  open,
  restoreFocus,
  onOpenChange,
  label,
  value,
  selected,
  options,
  onChange,
  disabled,
}: {
  open: boolean;
  restoreFocus: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  value: string;
  selected: string;
  options: readonly { id: string; label: string; hint?: string; disabled?: boolean }[];
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const viewport = useViewportTier();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverOpened = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const cancelHover = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const leave = () => {
    cancelHover();
    if (hoverOpened.current) timer.current = setTimeout(() => onOpenChange(false), 250);
  };
  const changeOpen = (next: boolean) => {
    cancelHover();
    onOpenChange(next);
  };
  return (
    <DropdownMenu modal={false} open={open && !disabled} onOpenChange={changeOpen}>
      <DropdownMenuTrigger asChild>
        <button
          ref={trigger}
          type="button"
          disabled={disabled}
          aria-label={`${label}: ${value}`}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'mouse' || viewport === 'phone' || disabled) return;
            cancelHover();
            if (!open) timer.current = setTimeout(() => {
              hoverOpened.current = true;
              onOpenChange(true);
            }, 150);
          }}
          onPointerLeave={leave}
          onPointerDown={(event) => {
            cancelHover();
            // A click on a row that just opened on hover keeps it open.
            if (open && hoverOpened.current && event.button === 0) event.preventDefault();
            hoverOpened.current = false;
          }}
          onKeyDown={(event) => {
            hoverOpened.current = false;
            if (event.key === 'ArrowRight' || (open && ['Enter', ' ', 'ArrowDown'].includes(event.key))) {
              event.preventDefault();
              changeOpen(true);
              content.current?.querySelector<HTMLElement>('[role="menuitemradio"]:not([data-disabled])')?.focus();
            }
          }}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[12px] transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <span>{label}</span>
          <span className="ml-auto truncate text-muted-foreground">
            {value}
          </span>
          <ChevronRight
            size={13}
            className="shrink-0 text-muted-foreground/60"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={content}
        side={viewport === 'phone' ? 'bottom' : 'right'}
        align="start"
        sideOffset={8}
        collisionPadding={8}
        className="w-52 max-w-[calc(100vw-1rem)] rounded-lg p-1"
        onPointerEnter={cancelHover}
        onPointerLeave={leave}
        onCloseAutoFocus={(event) => { if (!restoreFocus) event.preventDefault(); }}
        onInteractOutside={(event) => {
          // The trigger handles its own clicks, including pinning a hover menu.
          if (trigger.current?.contains(event.target as Node)) event.preventDefault();
        }}
        onKeyDown={(event) => {
          hoverOpened.current = false;
          cancelHover();
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            changeOpen(false);
          }
        }}
      >
        <DropdownMenuRadioGroup
          aria-label={label}
          value={selected}
          onValueChange={onChange}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.id}
              value={option.id}
              disabled={disabled || option.disabled}
              className="rounded-md px-2.5 py-2 text-[12px]"
            >
              <span>
                <span className="block">{option.label}</span>
                {option.hint && (
                  <span className="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground">
                    {option.hint}
                  </span>
                )}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
