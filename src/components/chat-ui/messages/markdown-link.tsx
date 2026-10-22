'use client';

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Popover } from 'radix-ui';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { markdownLinkTarget, markdownWebUrl } from './markdown-link-target';

function CopyLink({ value }: { value: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  useEffect(() => {
    if (status === 'idle') return;
    const timer = setTimeout(() => setStatus('idle'), 1800);
    return () => clearTimeout(timer);
  }, [status]);
  const label = status === 'copied' ? 'Copied' : status === 'error' ? 'Could not copy' : 'Copy';
  return <Button type="button" size="xs" variant="ghost" aria-label={label} onClick={async () => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus('copied');
    } catch {
      setStatus('error');
    }
  }}>
    {status === 'copied' ? <Check aria-hidden /> : <Copy aria-hidden />}
    <span role="status">{label}</span>
  </Button>;
}

type MarkdownLinkProps = ComponentProps<'a'> & { node?: unknown };

/** Native web links, with a small hover/focus copy panel. Other targets keep a dialog. */
export function MarkdownLink({ href: renderedHref, children, className, title, node, ...props }: MarkdownLinkProps) {
  void node; // Markdown's syntax node is not a DOM attribute.
  const href = renderedHref ? markdownLinkTarget(renderedHref) : renderedHref;
  const url = markdownWebUrl(href);
  const style = cn('wrap-anywhere text-left font-medium text-primary underline underline-offset-2', className);
  if (!href || href === 'streamdown:incomplete-link') return <span className={style}>{children}</span>;
  if (url) return <WebLink {...props} href={url} className={style} description={title}>{children}</WebLink>;
  return <Dialog>
    <DialogTrigger asChild><button type="button" className={style}>{children}</button></DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Open link</DialogTitle>
        <DialogDescription>{title || 'Copy this destination or open it in a new tab.'}</DialogDescription>
      </DialogHeader>
      <p className="max-h-48 overflow-y-auto break-all font-mono text-xs select-text">{href}</p>
      <DialogFooter>
        <CopyLink value={href} />
        <Button asChild size="sm"><a href={href} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden />Open in new tab</a></Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function WebLink({ description, children, ...props }: ComponentProps<'a'> & { description?: string }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const anchor = useRef<HTMLAnchorElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const clearTimer = () => clearTimeout(timer.current);
  useEffect(() => () => clearTimeout(timer.current), []);
  const changeOpen = (next: boolean) => { clearTimer(); setOpen(next); };
  const show = () => changeOpen(true);
  const scheduleClose = () => {
    clearTimer();
    timer.current = setTimeout(() => {
      if (document.activeElement !== anchor.current && !panel.current?.contains(document.activeElement)) changeOpen(false);
    }, 180);
  };
  return <Popover.Root open={open} onOpenChange={changeOpen}>
    <Popover.Anchor asChild>
      <a {...props} ref={anchor} target="_blank" rel="noopener noreferrer" data-streamdown="link"
        onPointerEnter={event => {
          if (event.pointerType === 'touch') return;
          clearTimer();
          if (!open) timer.current = setTimeout(show, 300);
        }}
        onPointerLeave={scheduleClose} onFocus={show} onBlur={scheduleClose}
        onKeyDown={event => {
          if (event.key === 'Tab' && !event.shiftKey && open) {
            const button = panel.current?.querySelector('button');
            if (button) { event.preventDefault(); button.focus(); }
          }
        }}
      >{children}</a>
    </Popover.Anchor>
    <Popover.Portal>
      <Popover.Content ref={panel} side="top" align="start" sideOffset={6} collisionPadding={12}
        aria-label="Link destination" onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
        onEscapeKeyDown={() => {
          if (panel.current?.contains(document.activeElement)) anchor.current?.focus();
        }}
        onInteractOutside={event => {
          if (anchor.current?.contains(event.target as Node)) event.preventDefault();
        }}
        onPointerEnter={clearTimer} onPointerLeave={scheduleClose} onFocus={clearTimer} onBlur={scheduleClose}
        onKeyDown={event => {
          if (event.key === 'Tab') {
            if (event.shiftKey) event.preventDefault();
            anchor.current?.focus();
            if (!event.shiftKey) changeOpen(false);
          }
        }}
        className="z-50 w-max max-w-[min(24rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-popover p-2.5 text-popover-foreground shadow-lg outline-none"
      >
        {description && <p className="mb-1 text-xs">{description}</p>}
        <div className="flex items-start gap-2">
          <p className="max-h-24 min-w-0 overflow-y-auto break-all font-mono text-[11px] leading-relaxed select-text">{props.href}</p>
          <CopyLink value={props.href!} />
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
