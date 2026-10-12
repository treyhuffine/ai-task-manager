/** Uploaded and remote documents never inherit the application's script authority. */
export const UNTRUSTED_DOCUMENT_HEADERS = {
  'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
} as const;
