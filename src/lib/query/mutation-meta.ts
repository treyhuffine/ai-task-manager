import type { QueryClient } from '@tanstack/react-query';

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** The request carries something the person typed, and this page holds
       * its only other copy until the home acknowledges it (a sent chat
       * message clears its composer, for example). Only these hold a reload,
       * close or update. Work the home runs on its own (archives, previews,
       * git, AI) keeps going after the page leaves, so it never does. */
      carriesInput?: boolean;
    };
  }
}

/** Requests that could still lose someone's typing if the page went away now.
 * The unload, close and version-reload guards all count through this. */
export function countUnsavedMutations(queryClient: QueryClient): number {
  return queryClient.isMutating({ predicate: mutation => mutation.meta?.carriesInput === true });
}
