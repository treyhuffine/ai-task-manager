import { uploadFolderFile } from '@/lib/folders/upload';
import { sessionFolder } from '@/lib/folders/source';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return uploadFolderFile(request, sessionFolder((await params).id));
}
