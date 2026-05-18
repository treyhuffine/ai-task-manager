import { memo } from 'react';
import { cn } from '@/lib/utils';
import { fileIconUrl, folderIconUrl } from '@/lib/file-icons';

interface FileIconProps {
  name: string;
  size?: number;
  className?: string;
}

interface FolderIconProps extends FileIconProps {
  opened: boolean;
}

export const FileIcon = memo(function FileIcon({ name, size = 14, className }: FileIconProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={fileIconUrl(name)}
      alt=""
      width={size}
      height={size}
      className={cn('shrink-0', className)}
    />
  );
});

export const FolderIcon = memo(function FolderIcon({
  name,
  opened,
  size = 14,
  className,
}: FolderIconProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={folderIconUrl(name, opened)}
      alt=""
      width={size}
      height={size}
      className={cn('shrink-0', className)}
    />
  );
});
