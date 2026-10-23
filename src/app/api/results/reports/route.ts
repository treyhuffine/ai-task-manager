import { workResultActorFromRequest, workResultRoute } from '@/lib/work-results/http';
import { agentReportSchema, saveAgentReport } from '@/lib/work-results/reports';

export function POST(request: Request) {
  return workResultRoute(async () => saveAgentReport(workResultActorFromRequest(request, { allowMissing: true }), agentReportSchema.parse(await request.json())));
}
