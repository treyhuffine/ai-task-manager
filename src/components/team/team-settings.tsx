'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Archive, Check, Copy, FolderPlus, House, LogOut, RotateCcw, Smartphone, UserMinus, UserPlus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiErrorStatus, apiErrorText } from '@/lib/api/client';
import { forgetTeamSignIn } from '@/lib/team/client';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { useTeam, useTeamNav } from './team-context';
import { useTeamMembers } from './use-team';
import { MemberAvatar } from './member-avatar';
import { NewAreaDialog } from './team-areas';
import { ConnectAiSection } from './connect-ai';
import { TeamAiSection } from './team-ai-settings';
import { useSpace } from '@/components/spaces/space-root';
import { useAreas, useUpdateArea } from '@/hooks/use-areas';
import { TeamAddressSetup } from './team-address-setup';
import { SettingsNavigation } from '@/components/settings/settings-nav';
import { TEAM_SETTINGS_SECTIONS, teamSettingsSection, type TeamSettingsSectionId } from './team-settings-sections';

/**
 * A team's Settings (docs/homes-spec.md §3.2): the team's name and where it's
 * hosted, its Areas, People and invitations for the owner, the member's own
 * name and sign-ins, the AI assistants they connect (§9.8), and the team's
 * own AI (§9.9). Nothing about
 * this device's service, which belongs to a person's own Ri and Desktop
 * Settings.
 */
export function TeamSettings() {
  const nav = useTeamNav();
  const { member } = useTeam();
  const addressRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [needsAddress, setNeedsAddress] = useState(false);
  const owner = member.role === 'owner';
  const settingUp = nav.remoteSetup && owner;
  const section = teamSettingsSection(nav.settingsSection, owner);
  // Keep visited forms mounted while the dialog is open, so changing sections
  // does not discard a name draft, an unsaved API key or a one-time link.
  const [visited, setVisited] = useState<TeamSettingsSectionId[]>([section.id]);
  if (!visited.includes(section.id)) setVisited([...visited, section.id]);
  const sections = TEAM_SETTINGS_SECTIONS.filter(item => owner || !item.ownerOnly);
  const needAddress = () => {
    setNeedsAddress(true);
    if (owner) nav.openSettings('remote');
  };
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    if (section.id === 'remote' && needsAddress) addressRef.current?.focus({ preventScroll: true });
  }, [section.id, needsAddress]);

  const content = (id: TeamSettingsSectionId) => {
    switch (id) {
      case 'general': return <TeamSection />;
      case 'people': return <PeopleSection onNeedAddress={needAddress} />;
      case 'areas': return <AreasSection />;
      case 'access': return <>
        {needsAddress && !owner && <p role="status" className="mb-4 text-sm text-muted-foreground">Ask a team owner to set up a reachable address before signing in elsewhere or connecting your personal Ri.</p>}
        <YouSection onNeedAddress={needAddress} />
      </>;
      case 'ai': return <TeamAiSection />;
      case 'external-ai': return <ConnectAiSection />;
      case 'remote': return <div ref={addressRef} tabIndex={-1} className="outline-none">
        {needsAddress && <p role="status" className="mb-4 text-sm text-muted-foreground">Set up or reconnect a remote address here, then try making your link again.</p>}
        <TeamAddressSetup onSaved={() => setNeedsAddress(false)} />
      </div>;
    }
  };

  return (
    <Dialog open={nav.panel === 'settings'} onOpenChange={(open) => { if (!open) { if (settingUp) nav.finishRemoteSetup(); else nav.openPanel(null); } }}>
      <DialogContent
        className={cn('flex max-h-[92dvh] w-full max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0',
          settingUp ? 'sm:max-w-xl' : 'h-[800px] sm:max-w-6xl sm:flex-row')}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.target as HTMLElement | null)?.focus();
        }}
      >
        {!settingUp && <SettingsNavigation label="Team settings" active={section.id} onSelect={nav.openSettings} sections={sections} />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DialogHeader className="gap-1 border-b border-border px-5 py-4 pr-12 text-left">
            <DialogTitle className="text-[15px] font-semibold">{settingUp ? 'Choose a team prefix' : section.title}</DialogTitle>
            <DialogDescription className="text-[12px] leading-snug">{settingUp ? 'A short name for your team’s address.' : section.description}</DialogDescription>
          </DialogHeader>
          <div ref={bodyRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-5">
            {settingUp ? <TeamAddressSetup onDone={nav.finishRemoteSetup} /> : sections.filter(item => visited.includes(item.id)).map(item => (
              <div key={item.id} hidden={section.id !== item.id} data-team-settings-section={item.id}>{content(item.id)}</div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="min-w-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function rowButton(tone: 'default' | 'danger' = 'default') {
  return cn(
    'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted/50 disabled:opacity-50',
    tone === 'danger' && 'text-red-600 dark:text-red-400',
  );
}

function NameField({ id, label, value, onSave, disabled }: { id?: string; label: string; value: string; onSave: (name: string) => Promise<unknown>; disabled?: boolean }) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const changed = draft.trim() && draft.trim() !== value;
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!changed) return;
        setBusy(true);
        try {
          await onSave(draft.trim());
          toast.success('Saved');
        } catch (err) {
          toast.error(apiErrorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="sr-only" htmlFor={id ?? `name-${label}`}>{label}</label>
      <input
        id={id ?? `name-${label}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={disabled}
        maxLength={80}
        className="min-w-0 flex-1 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary/60 disabled:opacity-70"
      />
      {!disabled && (
        <button type="submit" disabled={!changed || busy} className={rowButton()}>
          Save
        </button>
      )}
    </form>
  );
}

function TeamSection() {
  const { team, member } = useTeam();
  const qc = useQueryClient();
  return (
    <Section title="Team" hint={team.hostedOn ? `Hosted on ${team.hostedOn}. When that computer is asleep or offline, the team can't be reached.` : undefined}>
      <NameField
        label="Team name"
        value={team.name}
        disabled={member.role !== 'owner'}
        onSave={async (name) => {
          await trpcClient.team.rename.mutate({ name });
          await qc.invalidateQueries({ queryKey: trpc.team.me.queryKey() });
        }}
      />
    </Section>
  );
}

/** The team's Areas: anyone can add, rename, archive and restore them. */
function AreasSection() {
  const { data: active = [] } = useAreas();
  const { data: archived = [] } = useAreas({ status: 'archived' });
  const update = useUpdateArea();
  const [creating, setCreating] = useState(false);
  return (
    <Section title="Areas" hint="Optional. They organize the team's work for everyone and never limit who sees what.">
      {active.map((area) => (
        <div key={area.id} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <NameField id={`area-${area.id}`} label={`Name of ${area.name}`} value={area.name} onSave={(name) => update.mutateAsync({ id: area.id, name })} />
          </div>
          <button type="button" className={rowButton()} onClick={() => update.mutate({ id: area.id, status: 'archived' })}>
            <Archive className="size-3.5" /> Archive
          </button>
        </div>
      ))}
      <button type="button" className={rowButton()} onClick={() => setCreating(true)}>
        <FolderPlus className="size-3.5" /> New area
      </button>
      {archived.length > 0 && (
        <div className="space-y-1.5 pt-2">
          <p className="text-xs text-muted-foreground">Archived</p>
          {archived.map((area) => (
            <div key={area.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-muted-foreground">{area.name}</span>
              <button type="button" className={rowButton()} onClick={() => update.mutate({ id: area.id, status: 'active' })}>
                <RotateCcw className="size-3.5" /> Restore
              </button>
            </div>
          ))}
        </div>
      )}
      <NewAreaDialog open={creating} onOpenChange={setCreating} />
    </Section>
  );
}

function CopyLink({ link, note }: { link: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate text-[11px] select-all">{link}</code>
        <button
          type="button"
          className={rowButton()}
          onClick={async () => {
            await navigator.clipboard.writeText(link).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {note && <p className="mt-1.5 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function PeopleSection({ onNeedAddress }: { onNeedAddress: () => void }) {
  const { member } = useTeam();
  const owner = member.role === 'owner';
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { active } = useTeamMembers();
  const invitations = useQuery({ ...trpc.team.invitations.list.queryOptions(), enabled: owner });
  const [latest, setLatest] = useState<{ link: string; reachable: boolean; expiresAt: string } | null>(null);
  const invite = useMutation({
    mutationFn: () => trpcClient.team.invitations.createRemote.mutate(),
    onSuccess: (made) => {
      if (made.reachable) setLatest(made);
      else { setLatest(null); onNeedAddress(); }
      void invitations.refetch();
    },
    onError: (err) => {
      if (apiErrorStatus(err) === 412) { setLatest(null); onNeedAddress(); }
      else toast.error(apiErrorText(err));
    },
  });
  const pending = (invitations.data ?? []).filter((i) => i.state === 'valid');
  return (
    <Section title="People">
      <ul className="divide-y divide-border/60 rounded-md border border-border">
        {active.map((m) => (
          <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <MemberAvatar name={m.name} size="sm" />
            <span className="min-w-0 flex-1 truncate">
              {m.name}
              {m.id === member.id && <span className="text-muted-foreground"> (you)</span>}
            </span>
            <span className="text-[11px] text-muted-foreground">{m.role === 'owner' ? 'Owner' : 'Member'}</span>
            {owner && m.id !== member.id && (
              <button
                type="button"
                aria-label={`Remove ${m.name}`}
                className="rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-red-600"
                onClick={async () => {
                  if (!(await confirm({ title: `Remove ${m.name}?`, description: 'They\'re signed out everywhere at once. What they did keeps their name.', confirmLabel: 'Remove', tone: 'destructive' }))) return;
                  try {
                    await trpcClient.team.removeMember.mutate({ id: m.id });
                    await qc.invalidateQueries({ queryKey: trpc.team.members.queryKey() });
                  } catch (err) {
                    toast.error(apiErrorText(err));
                  }
                }}
              >
                <UserMinus size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {owner && (
        <>
          <button type="button" className={rowButton()} onClick={() => invite.mutate()} disabled={invite.isPending}>
            <UserPlus size={13} /> Invite people
          </button>
          {latest && (
            <CopyLink
              link={latest.link}
              note={
                latest.reachable
                  ? `One person can join with this link until ${new Date(latest.expiresAt).toLocaleDateString()}. Make another for each person.`
                  : 'This link works only on this computer until the team has an address people can reach. Set one in Remote access.'
              }
            />
          )}
          {pending.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {pending.map((inv) => (
                <li key={inv.id} className="flex items-center gap-2">
                  <span className="flex-1">Invitation made {new Date(inv.createdAt).toLocaleDateString()}, not used yet</span>
                  <button
                    type="button"
                    className="underline"
                    onClick={async () => {
                      await trpcClient.team.invitations.revoke.mutate({ id: inv.id });
                      void invitations.refetch();
                    }}
                  >
                    Withdraw
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}


function YouSection({ onNeedAddress }: { onNeedAddress: () => void }) {
  const { member } = useTeam();
  const qc = useQueryClient();
  const signIns = useQuery(trpc.team.signIns.list.queryOptions());
  // Shown inside My Ri, this page's sign-in is My Ri's own: signing it out or
  // connecting My Ri again belongs in My Ri's Settings, Teams.
  const space = useSpace();
  // A sign-in link, for another device or for the person's own Ri.
  const [link, setLink] = useState<{ value: string; forHome: boolean } | null>(null);
  const makeLink = async (forHome: boolean) => {
    try {
      const made = await trpcClient.team.signIns.createRemote.mutate();
      if (!made.reachable) {
        setLink(null);
        onNeedAddress();
        return;
      }
      setLink({ value: made.link, forHome });
    } catch (err) {
      if (apiErrorStatus(err) === 412) { setLink(null); onNeedAddress(); }
      else toast.error(apiErrorText(err));
    }
  };
  return (
    <Section title="You">
      <NameField
        label="Your name"
        value={member.name}
        onSave={async (name) => {
          await trpcClient.team.renameMe.mutate({ name });
          await qc.invalidateQueries({ queryKey: trpc.team.me.queryKey() });
          await qc.invalidateQueries({ queryKey: trpc.team.members.queryKey() });
        }}
      />
      <ul className="divide-y divide-border/60 rounded-md border border-border">
        {(signIns.data ?? []).map((s) => (
          <li key={s.keyId} className="flex items-center gap-2 px-3 py-2 text-xs">
            {s.deviceKind === 'service' ? <House size={13} className="text-muted-foreground" /> : <Smartphone size={13} className="text-muted-foreground" />}
            <span className="min-w-0 flex-1 truncate">
              {s.deviceName}
              {s.current && <span className="text-muted-foreground"> (this one)</span>}
            </span>
            {!s.current && (
              <button
                type="button"
                className="underline text-muted-foreground"
                onClick={async () => {
                  await trpcClient.team.signIns.revoke.mutate({ keyId: s.keyId });
                  void signIns.refetch();
                }}
              >
                Sign out there
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={rowButton()} onClick={() => void makeLink(false)}>
          <Smartphone size={13} /> Sign in on another device
        </button>
        {!space && (
          <>
            <button type="button" className={rowButton()} onClick={() => void makeLink(true)}>
              <House size={13} /> Connect to My Ri
            </button>
            <button
              type="button"
              className={rowButton('danger')}
              onClick={async () => {
                await trpcClient.team.signIns.signOut.mutate().catch(() => {});
                forgetTeamSignIn();
                window.location.assign('/');
              }}
            >
              <LogOut size={13} /> Sign out here
            </button>
          </>
        )}
      </div>
      {space && (
        <p className="text-xs text-muted-foreground">
          Connected to My Ri. To disconnect it, use My Ri&apos;s{' '}
          <button type="button" className="underline" onClick={() => window.location.assign('/?settings=teams')}>
            Settings, Teams
          </button>
          .
        </p>
      )}
      {link && (
        <CopyLink
          link={link.value}
          note={
            link.forHome
              ? 'If you use Ri yourself, paste it in your own Ri under Settings, Teams, within 15 minutes. Work assigned to you then appears there too, and nothing personal comes to the team.'
              : 'Open it on the other device within 15 minutes. It signs you in there once.'
          }
        />
      )}
    </Section>
  );
}
