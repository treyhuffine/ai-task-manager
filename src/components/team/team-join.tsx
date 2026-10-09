'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getAuthToken } from '@/lib/api/client';
import {
  finishTeamSetup,
  joinTeam,
  keepTeamSignIn,
  previewTeamLink,
  readSetupAttempt,
  signInToTeam,
  TeamRequestError,
  TeamUnreachableError,
  type Admitted,
  type GrantPreview,
} from '@/lib/team/client';
import { TEAM_LINK_KINDS, type TeamLinkKind } from '@/lib/team/links';
import { trpcClient } from '@/lib/trpc/client';
import { GateButton, GateField, GateNotice, TeamGate } from './team-gate';
import { TeamSignedOut } from './team-signed-out';

type Link = { kind: TeamLinkKind; secret: string };

type Stage =
  | { stage: 'reading' }
  | { stage: 'unreachable' }
  | { stage: 'already-in'; team: string }
  | { stage: 'preview'; preview: GrantPreview };

let parsed: { hash: string; link: Link | null } | null = null;

/** The link in this page's fragment, the same object for the same fragment. */
function readLink(): Link | null {
  const hash = window.location.hash;
  if (parsed?.hash === hash) return parsed.link;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  let link: Link | null = null;
  for (const kind of TEAM_LINK_KINDS) {
    const secret = params.get(kind);
    if (secret) {
      link = { kind, secret };
      break;
    }
  }
  parsed = { hash, link };
  return link;
}

function onHashChange(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

/** Where a link should land: the shared record it names, else the Task Board. */
function landing(): string {
  const open = new URLSearchParams(window.location.search).get('open');
  const match = open?.match(/^(task|note):([A-Za-z0-9-]{8,80})$/);
  return match ? `/?${match[1]}=${match[2]}` : '/';
}

const REFUSED: Record<GrantPreview['state'], string> = {
  valid: '',
  unknown: "This link isn't valid. Ask the team's owner for a new one.",
  expired: "This link has expired. Ask the team's owner for a new one.",
  used: 'This link was already used. Ask for a new one if you still need it.',
  revoked: 'This link was withdrawn. Ask the team\'s owner for a new one.',
};

/**
 * A team link's landing (docs/homes-spec.md §3.1): Join Acme with an
 * invitation, sign in here as an existing member, or name a team and become
 * its owner with an operator's setup link. Works in any browser with no
 * download, personal Ri or AI.
 */
export function TeamJoin() {
  const link = useSyncExternalStore(onHashChange, readLink, () => undefined);
  const [stage, setStage] = useState<Stage>({ stage: 'reading' });

  const load = useCallback((current: Link) => {
    void resolveStage(current).then(setStage);
  }, []);

  useEffect(() => {
    if (link) load(link);
  }, [link, load]);

  if (link === undefined) return null;
  if (link === null) return <TeamSignedOut />;

  if (stage.stage === 'reading') {
    return (
      <TeamGate title="Opening your link">
        <p>One moment…</p>
      </TeamGate>
    );
  }
  if (stage.stage === 'unreachable') {
    return (
      <TeamGate title="Can't reach this team">
        <p>The computer hosting it may be asleep or offline. Your link is kept.</p>
        <GateButton
          onClick={() => {
            setStage({ stage: 'reading' });
            load(link);
          }}
        >
          Retry
        </GateButton>
      </TeamGate>
    );
  }
  if (stage.stage === 'already-in') {
    return (
      <TeamGate title={`You're in ${stage.team}`}>
        <p>This device is already signed in to the team.</p>
        <GateButton onClick={() => window.location.replace(landing())}>Open {stage.team}</GateButton>
      </TeamGate>
    );
  }

  const { preview } = stage;
  if (preview.state !== 'valid' || !preview.team) {
    return (
      <TeamGate title={preview.team ? preview.team.name : 'This link can\'t be used'}>
        <GateNotice tone="error">{REFUSED[preview.state === 'valid' ? 'unknown' : preview.state]}</GateNotice>
      </TeamGate>
    );
  }
  if (link.kind === 'invite') return <JoinForm link={link} team={preview.team.name} />;
  if (link.kind === 'sign-in') return <SignInHere link={link} team={preview.team.name} member={preview.member?.name ?? 'you'} />;
  return <SetupForm link={link} />;
}

/** What a link opens here: the team for a member already in, else what the link is. */
async function resolveStage(current: Link): Promise<Stage> {
  // Already a member here: reopening the invitation returns to the team.
  if (getAuthToken()) {
    try {
      const me = await trpcClient.team.me.query();
      return { stage: 'already-in', team: me.team.name };
    } catch {
      // Not signed in after all: carry on with the link.
    }
  }
  try {
    return { stage: 'preview', preview: await previewTeamLink(current.kind, current.secret) };
  } catch (err) {
    return err instanceof TeamUnreachableError
      ? { stage: 'unreachable' }
      : { stage: 'preview', preview: { kind: 'team', state: 'unknown', team: null, member: null, expiresAt: null } };
  }
}

async function enter(admit: () => Promise<Admitted>, onError: (message: string) => void, onUnreachable: () => void) {
  try {
    const admitted = await admit();
    await keepTeamSignIn(admitted.token);
    window.location.replace(landing());
  } catch (err) {
    if (err instanceof TeamUnreachableError) onUnreachable();
    else onError(err instanceof TeamRequestError ? err.message : 'Something went wrong. Try again.');
  }
}

function JoinForm({ link, team }: { link: Link; team: string }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <TeamGate title={`Join ${team}`} footer={`You'll see ${team}'s shared tasks and notes. Nothing of yours is shared unless you add it to the team.`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          void enter(
            () => joinTeam(link.secret, name),
            (message) => {
              setError(message);
              setBusy(false);
            },
            () => {
              setError("Ri couldn't reach the team. Your link is kept. Try again.");
              setBusy(false);
            },
          );
        }}
      >
        <GateField id="member-name" label="Your name" hint="What the team sees on your work." value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus maxLength={80} />
        {error && <GateNotice tone="error">{error}</GateNotice>}
        <GateButton type="submit" busy={busy} disabled={!name.trim()}>
          Join team
        </GateButton>
      </form>
    </TeamGate>
  );
}

function SignInHere({ link, team, member }: { link: Link; team: string; member: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <TeamGate title={`Sign in to ${team}`}>
      <p>
        This signs <span className="font-medium text-foreground">{member}</span> in on this device. You can sign it out later from Settings, You.
      </p>
      {error && <GateNotice tone="error">{error}</GateNotice>}
      <GateButton
        busy={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void enter(
            () => signInToTeam(link.secret),
            (message) => {
              setError(message);
              setBusy(false);
            },
            () => {
              setError("Ri couldn't reach the team. Your link is kept. Try again.");
              setBusy(false);
            },
          );
        }}
      >
        Sign in on this device
      </GateButton>
    </TeamGate>
  );
}

function SetupForm({ link }: { link: Link }) {
  const [teamName, setTeamName] = useState(() => readSetupAttempt(link.secret)?.teamName ?? '');
  const [ownerName, setOwnerName] = useState(() => readSetupAttempt(link.secret)?.ownerName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <TeamGate title="Set up your team" footer={`Hosted at ${typeof window === 'undefined' ? '' : window.location.host}. Everyone you invite uses this address.`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          void enter(
            () => finishTeamSetup(link.secret, teamName, ownerName),
            (message) => {
              setError(message);
              setBusy(false);
            },
            () => {
              setError("Ri couldn't reach the team. Your link is kept. Try again.");
              setBusy(false);
            },
          );
        }}
      >
        <GateField id="team-name" label="Team name" hint="You can change it later." value={teamName} onChange={(e) => setTeamName(e.target.value)} autoFocus maxLength={80} />
        <GateField id="owner-name" label="Your name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} autoComplete="name" maxLength={80} />
        {error && <GateNotice tone="error">{error}</GateNotice>}
        <GateButton type="submit" busy={busy} disabled={!teamName.trim() || !ownerName.trim()}>
          Create team
        </GateButton>
      </form>
    </TeamGate>
  );
}
