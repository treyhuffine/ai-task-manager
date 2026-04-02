import { File, FileText } from 'lucide-react';

interface NoteIconProps {
  body?: string | null;
  size?: number;
  className?: string;
}

/** Shows FileText (lines) when note has content, plain File (blank) when empty. */
export function NoteIcon({ body, size = 14, className }: NoteIconProps) {
  const hasContent = !!body?.trim();
  const Icon = hasContent ? FileText : File;
  return <Icon size={size} className={className} />;
}
