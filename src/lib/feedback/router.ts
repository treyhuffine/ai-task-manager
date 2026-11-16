import { router, sharedProcedure as sp } from '@/lib/trpc/init';
import { FeedbackInputSchema } from './schema';
import { prepareGitHubIssue } from './submit';

export const feedbackRouter = router({
  preparePublicIssue: sp
    .input(FeedbackInputSchema)
    .mutation(({ input }) => prepareGitHubIssue(input)),
});
