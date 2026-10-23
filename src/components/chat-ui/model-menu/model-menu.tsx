'use client';

import type { ReactNode } from 'react';
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
  CommandList,
} from '@/components/ui/command';
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
  const effortLabel =
    efforts.find((option) => option.id === effort)?.label ?? effort ?? 'Choose';
  const variants = variant?.options.filter((option) => !option.disabled) ?? [];
  const showSpeed = speed && (speed.modes.some(mode => mode !== 'default')
    || (speed.value && speed.value !== 'default' && speed.modes.includes('default')));
  return (
    <div className="min-w-0">
      <Command
        label="Search models"
        className="h-auto rounded-none bg-transparent"
      >
        <CommandInput
          placeholder="Search models"
          aria-label="Search models"
          className="h-10 text-[12px]"
        />
        <CommandList className="max-h-[min(280px,40dvh)] p-1.5">
          <CommandEmpty className="px-3 py-6 text-center text-[12px] text-muted-foreground">
            No supported models match.
          </CommandEmpty>
          {children}
        </CommandList>
      </Command>
      <div className="border-t border-border p-1.5">
        {efforts.length > 0 && onEffortChange && (
          <OptionRow
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
        <div className="border-t border-border px-2.5 pb-0.5 pt-2">
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
  label,
  value,
  selected,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  selected: string;
  options: readonly { id: string; label: string; hint?: string; disabled?: boolean }[];
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const viewport = useViewportTier();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${label}: ${value}`}
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
        side={viewport === 'phone' ? 'bottom' : 'right'}
        align="start"
        sideOffset={8}
        collisionPadding={8}
        className="w-52 max-w-[calc(100vw-1rem)] rounded-lg p-1"
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
              disabled={option.disabled}
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
