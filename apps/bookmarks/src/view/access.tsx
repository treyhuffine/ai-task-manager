/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Choose what a chat may do with Bookmarks. Opened by Ri with the chat already
 * bound, so the choice here cannot be redirected to another caller. Nothing is
 * shared until the owner saves the access in Ri.
 */
import { useState } from "react";
import { AppShell, Notice, ShareScopeChooser, useMutation } from "@ri/app-kit/ui";
import { useNav } from "./app.js";

export function AccessScreen() {
  const { data } = useNav();
  const create = useMutation<Record<string, unknown>, { scopeRef: string }>("create_scope");
  const [done, setDone] = useState(false);
  const access = data.access;
  return (
    <AppShell eyebrow="Bookmarks" title="Share Bookmarks with a chat" context="Bookmarks are shared as a whole. Choose what this chat may do with them.">
      {!access ? (
        <Notice tone="warning">Open this from a chat's access settings in Ri.</Notice>
      ) : done ? (
        <Notice tone="success" title="Access is ready." live>Save it in Ri to finish. Until then the chat cannot use your bookmarks.</Notice>
      ) : (
        <ShareScopeChooser
          actorLabel="this chat"
          sources={access.sources.map((source) => ({ id: source.key, label: source.label, textLabel: source.label }))}
          operations={[
            { id: "read", label: "Search and read links", description: "Titles, links, notes, tags and saved page text" },
            { id: "write", label: "Save and change links", description: "Add links and edit titles, notes and tags. Deleting stays with you" },
          ]}
          busy={create.pending}
          error={create.error}
          onCreate={async (sources, operations) => {
            // The host binds actorId to the chat that asked, so the value here cannot point elsewhere.
            await create.run({ actorId: access.actorId, sources, operations, label: "Shared Bookmarks" });
            setDone(true);
          }}
        />
      )}
    </AppShell>
  );
}
