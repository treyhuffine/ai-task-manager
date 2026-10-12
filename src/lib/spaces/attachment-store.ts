import type { Attachment } from '@/db/types';
import type { AttachmentStore } from '@/components/editor/upload-files';
import { api } from '@/lib/api/client';
import { spaceApiBase } from './document';

export function spaceAttachmentStore(teamId: string): AttachmentStore {
  return {
    upload: (file) => {
      const form = new FormData();
      form.append('file', file);
      return api.upload<Attachment>(`${spaceApiBase(teamId).replace(/^\/api/, '')}/attachments`, form);
    },
    url: (fileName) => `${spaceApiBase(teamId)}/attachments/${fileName}`,
  };
}
