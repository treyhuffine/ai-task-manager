import { toast } from 'sonner';

/**
 * Best-effort `navigator.clipboard.writeText` with a `document.execCommand`
 * fallback for older browsers / non-HTTPS dev contexts (the modern API
 * requires a secure context). Toasts success and failure so the caller
 * doesn't have to wire up its own feedback.
 *
 * Used by the file tree kebab, the file viewer header, and anywhere else
 * we need "copy this path / value" affordances.
 */
export async function copyText(text: string, successMessage: string): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    toast.success(successMessage, { description: text });
  } catch (err) {
    toast.error('Copy failed', {
      description: err instanceof Error ? err.message : String(err),
    });
  }
}
