/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Choose which Travel records a chat may use. Opened by Ri with the chat
 * already bound, so the choice here cannot be redirected to another caller.
 * Nothing is shared until the owner saves the access in Ri.
 */
import { useState } from "react";
import { AppShell, Notice, ShareScopeChooser, useMutation } from "@ri/app-kit/ui";
import { useNav } from "./app.js";
import { cleanError, cleanly } from "./util.js";

export function AccessScreen() {
  const { data } = useNav();
  const create = useMutation<Record<string, unknown>, { scopeRef: string }>("create_scope");
  const [done, setDone] = useState(false);
  const access = data.access;
  return (
    <AppShell eyebrow="Travel" title="Share Travel with a chat" context="Choose the accounts and collections it may use.">
      {!access ? (
        <Notice tone="warning">Open this from a chat's access settings in Ri.</Notice>
      ) : done ? (
        <Notice tone="success" title="Access is ready." live>Save it in Ri to finish. Until then the chat cannot use these records.</Notice>
      ) : (
        <ShareScopeChooser
          actorLabel="this chat"
          sources={access.sources.map((source) => ({ id: source.key, label: source.label, description: source.detail ?? undefined, textLabel: source.label }))}
          operations={[
            { id: "read", label: "Read trips and bookings", description: "Itineraries, bookings, ideas and coverage from the chosen sources" },
            { id: "write", label: "Change records", description: "Correct bookings, save ideas and create follow-ups. Review decisions stay with you" },
          ]}
          busy={create.pending}
          error={cleanError(create.error)}
          onCreate={async (sources, operations) => {
            // The host binds actorId to the chat that asked, so the value here cannot point elsewhere.
            await cleanly(() => create.run({ actorId: access.actorId, sources, operations, label: "Shared Travel records" }));
            setDone(true);
          }}
        />
      )}
    </AppShell>
  );
}
