'use client';

import { useEffect, useState } from 'react';
import { parseTeamLink } from '@/lib/team/links';
import { teamInfo } from '@/lib/team/client';
import { GateButton, GateField, GateNotice, TeamGate } from './team-gate';

/**
 * A team's address without a sign-in (docs/homes-spec.md §3.1: "Sign-in or
 * invitation instructions, never an owner-creation form"). A bare address
 * proves nothing, so this says how to get in and takes a link.
 */
export function TeamSignedOut() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    teamInfo().then((info) => setReady(info.ready)).catch(() => setReady(true));
  }, []);

  const open = () => {
    const parsed = parseTeamLink(link);
    if (!parsed) {
      setError(/#token=/.test(link) ? "That's a link for a personal Ri, not this team." : "That isn't a team link. Paste the whole link you were sent.");
      return;
    }
    if (parsed.origin !== window.location.origin) {
      window.location.assign(link.trim());
      return;
    }
    window.location.assign(`/join#${parsed.kind}=${parsed.secret}`);
  };

  if (ready === false) {
    return (
      <TeamGate title="This team is being set up">
        <p>The computer that hosts it hasn&apos;t named it or made its owner yet.</p>
        <p>
          On that computer, run <code className="rounded bg-muted px-1 py-0.5 text-[12px] text-foreground">ri team setup-link</code> and open the
          link it prints.
        </p>
      </TeamGate>
    );
  }

  return (
    <TeamGate
      title="Sign in to this team"
      footer="You don't need your own Ri, an agent or any setup to use a team."
    >
      <p>To join, open the invitation link someone in the team sent you.</p>
      <p>Already a member? Open a sign-in link from a device where you&apos;re signed in. It&apos;s under Settings, You.</p>
      <form
        className="space-y-3 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          open();
        }}
      >
        <GateField
          id="team-link"
          label="Ri link"
          hint="Paste an invitation or a sign-in link."
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setError(null);
          }}
          autoComplete="off"
          spellCheck={false}
          placeholder="https://…/join#invite=…"
        />
        {error && <GateNotice tone="error">{error}</GateNotice>}
        <GateButton type="submit" disabled={!link.trim()}>
          Continue
        </GateButton>
      </form>
    </TeamGate>
  );
}
