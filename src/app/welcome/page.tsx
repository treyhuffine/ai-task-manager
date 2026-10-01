import { redirect } from 'next/navigation';

/**
 * There's no setup wizard any more: a new home opens straight on the
 * dashboard, and its main chat walks through first-run setup, the harness
 * included (docs/main-chat-onboarding.md). The route stays so old links,
 * bookmarks and sign-in returns that name it still land home.
 */
export default function WelcomePage() {
  redirect('/');
}
