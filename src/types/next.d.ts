/// <reference types="next" />
/// <reference types="next/image-types/global" />

// Next rewrites root next-env.d.ts with whichever build starts last. Keep
// common ambient types here and select generated route types in each profile's
// tsconfig instead, so concurrent web/desktop builds cannot cross-import caches.
