"use client";

import { useAreas } from '@/hooks/use-areas';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface AreaSelectProps {
  value: string | null;
  onChange: (areaId: string | null) => void;
  className?: string;
}

export function AreaSelect({ value, onChange, className }: AreaSelectProps) {
  const { data: areas } = useAreas();
  const selected = areas?.find(a => a.id === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider transition-colors',
            'hover:bg-primary/10 cursor-pointer',
            selected ? 'text-primary/80 bg-primary/5' : 'text-muted-foreground',
            className,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {selected ? selected.name : 'No area'}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItem
          onClick={(e) => { e.stopPropagation(); onChange(null); }}
          className={cn('text-xs', !value && 'font-bold')}
        >
          No area
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {areas?.map(area => (
          <DropdownMenuItem
            key={area.id}
            onClick={(e) => { e.stopPropagation(); onChange(area.id); }}
            className={cn('text-xs', area.id === value && 'font-bold')}
          >
            {area.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
