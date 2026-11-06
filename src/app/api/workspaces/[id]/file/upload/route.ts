import { uploadFolderFile } from '@/lib/folders/upload';
import { workspaceFolder } from '@/lib/folders/source';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return uploadFolderFile(request, workspaceFolder((await params).id));
}
