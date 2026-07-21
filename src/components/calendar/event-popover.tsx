"use client";

/**
 * Read-only event details: time, attribution, location, join link, and a deep
 * link into the provider's own UI. Deliberately no edit affordances — event
 * management stays in the source calendar (or conversational, later).
 */

import { ExternalLink, MapPin, Video } from 'lucide-react';
import type { CalendarEvent } from '@/lib/calendar/types';

const PROVIDER_LABEL: Record<CalendarEvent['providerId'], string> = {
  google: 'Google Calendar',
  microsoft: 'Outlook',
};

function timeRange(e: CalendarEvent): string {
  if (e.allDay) return 'All day';
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };
  return `${fmt(e.start)} to ${fmt(e.end)}`;
}

function rsvpNote(e: CalendarEvent): string | null {
  if (e.rsvp === 'declined') return 'Declined';
  if (e.rsvp === 'tentative') return 'Tentative';
  if (e.transparency === 'free') return 'Shows as free';
  if (e.rsvp === 'needs_action') return 'Not responded';
  return null;
}

export function EventPopoverContent({ event }: { event: CalendarEvent }) {
  const note = rsvpNote(event);
  return (
    <div className="w-72 p-3 space-y-2">
      <div>
        <p className="text-sm font-medium text-foreground leading-snug">{event.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {timeRange(event)}
          {note && <span className="text-muted-foreground/60"> · {note}</span>}
        </p>
      </div>

      {event.location && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin size={11} className="shrink-0" />
          <span className="truncate">{event.location}</span>
        </p>
      )}

      <p className="text-[10px] text-muted-foreground/60">{PROVIDER_LABEL[event.providerId]}</p>

      {(event.joinUrl || event.sourceUrl) && (
        <div className="flex items-center gap-2 pt-1">
          {event.joinUrl && (
            <a
              href={event.joinUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90 transition-opacity"
            >
              <Video size={11} />
              Join
            </a>
          )}
          {event.sourceUrl && (
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink size={11} />
              Open in {PROVIDER_LABEL[event.providerId]}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
