"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { trpcClient } from "@/lib/trpc/client";
import { KEY } from "./app-hooks";
import { toast } from "sonner";
function openReference(content: string) {
  if (content.length > 100000) return null;
  let nodes = 0;
  const find = (value: unknown, depth = 0): string | null => {
    if (depth > 8 || ++nodes > 200) return null;
    if (typeof value === "string") {
      try {
        return find(JSON.parse(value), depth + 1);
      } catch {
        return null;
      }
    }
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (
      record.control === "Open app" &&
      typeof record.reference === "string" &&
      /^[a-f0-9-]{36}$/.test(record.reference)
    )
      return record.reference;
    for (const item of Object.values(record)) {
      const reference = find(item, depth + 1);
      if (reference) return reference;
    }
    return null;
  };
  return find(content);
}
export function AppOpenControl({
  content,
  chatId,
}: {
  content: string;
  chatId: string;
}) {
  const reference = openReference(content),
    qc = useQueryClient(),
    [busy, setBusy] = useState(false);
  if (!reference) return null;
  return (
    <button
      className="rounded border px-2 py-1 text-xs hover:bg-muted"
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        setBusy(true);
        void trpcClient.localApps.acceptOpen
          .mutate({ chatId, reference })
          .then(() => qc.invalidateQueries({ queryKey: KEY }))
          .catch((error) => toast.error(error.message))
          .finally(() => setBusy(false));
      }}
    >
      Open app
    </button>
  );
}
