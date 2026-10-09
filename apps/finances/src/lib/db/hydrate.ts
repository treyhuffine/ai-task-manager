import type {Attachment,StoredAttachment} from '@/db/types';
export function dehydrateAttachments(items:Attachment[]):StoredAttachment[]{return items.map(i=>({file_name:i.fileName,original_name:i.originalName,mime_type:i.mimeType,size:i.size,uploaded_at:i.uploadedAt}));}
