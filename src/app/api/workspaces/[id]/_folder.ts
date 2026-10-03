import { agentFolderAnswer, agentFolderWriteAnswer } from '@/lib/workspaces/agent-folder-operations';
import type { AgentFolderRead } from '@/lib/workspaces/agent-folder-reads';
import type { FolderWrite } from '@/lib/workspaces/execution-writes';
export async function agentFolderResponse(id: string, read: AgentFolderRead) {
 const answer = await agentFolderAnswer(id, read);
 return Response.json(answer.body, { status: answer.status });
}
export async function agentFolderWrite(id: string, write: FolderWrite) {
 const answer = await agentFolderWriteAnswer(id, write);
 return Response.json(answer.body, { status: answer.status });
}
