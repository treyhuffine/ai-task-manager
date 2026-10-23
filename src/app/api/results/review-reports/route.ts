import { workResultActorFromRequest, workResultRoute } from '@/lib/work-results/http';
import { reviewReportSchema, saveReviewReport } from '@/lib/work-results/reports';

export function POST(request: Request) {
  return workResultRoute(async () => saveReviewReport(workResultActorFromRequest(request, { allowMissing: true }), reviewReportSchema.parse(await request.json())));
}
