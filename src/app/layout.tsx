import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { TipProvider } from "@/components/ui/tip";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { QueryProvider } from "@/providers/query-provider";
import { PairingBootstrap } from "@/components/auth/pairing-bootstrap";
import { HomeReachabilityBanner } from "@/components/app/home-reachability-banner";
import { HomeEnvironmentMarker } from "@/components/app/home-environment-marker";
import { LifecycleGuardProvider } from "@/components/tasks/lifecycle-guard";
import "./globals.css";
import { APP_NAME } from "@/constants/app";
import { DesktopChrome } from '@/components/desktop/desktop-chrome';
import { ServiceConnection } from '@/components/desktop/service-connection';
import { WebAppBootstrap } from '@/components/settings/phone-install';
import { QuickCaptureHost } from '@/components/dashboard/quick-capture-host';
import { TeamRoot } from '@/components/team/team-root';
import { isTeamPage } from '@/lib/team/page-authority';
import { ArtifactPreviewProvider } from '@/components/chat-ui/artifacts/artifact-preview-provider';
import { spacePage } from '@/lib/spaces/page';
import { SpaceRoot } from '@/components/spaces/space-root';
import { getHome, getTeamConnection } from '@/lib/db/queries';
import { headers } from 'next/headers';
import { ClientAppearance } from '@/lib/client/theme';
import { initialHomeContextForRequest } from '@/lib/home/context';

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Productivity framework for humans and agents combined",
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: 'default' },
};

export const viewport: Viewport = { themeColor: '#181a18' };

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // A team space is the same app with a different shell: no pairing, service
  // controls, capture or personal banners, which all reach personal routes
  // (docs/homes-spec.md §3.2, §9.2).
  const team = await isTeamPage();
  // A team's space inside My Ri (`/space/<team>`, P7.1) is the team's own
  // app, its API reached through this home, so nothing personal mounts in
  // it either.
  const space = team ? null : await spacePage();
  // A connected Team authenticates at its own server. Never seed it with this
  // personal server's context. Other signed-in documents can render immediately.
  const initialHomeContext = space ? undefined : await initialHomeContextForRequest(await headers());
  const documentHome = space?.id ?? initialHomeContext?.home.id ?? getHome()?.id;
  const documentViewer = space ? getTeamConnection(space.id)?.memberId : initialHomeContext?.viewer.id ?? 'local';
  return (
    <html
      lang="en"
      className={`${inter.variable} dark`}
      data-ri-authority={team ? 'team' : space ? 'space' : 'personal'}
      data-ri-home={documentHome}
      data-ri-viewer={documentViewer}
      {...(space ? { 'data-ri-space': space.id } : {})}
    >
      <body className="antialiased">
        <ClientAppearance />
        <QueryProvider initialHomeContext={initialHomeContext}>
          {team ? (
            <TipProvider>
              <DesktopChrome />
              <ConfirmProvider>
                <ArtifactPreviewProvider>
                  <TeamRoot>{children}</TeamRoot>
                </ArtifactPreviewProvider>
              </ConfirmProvider>
            </TipProvider>
          ) : space ? (
            <TipProvider>
              <DesktopChrome />
              <ConfirmProvider>
                <ArtifactPreviewProvider>
                  <SpaceRoot space={space}>{children}</SpaceRoot>
                </ArtifactPreviewProvider>
              </ConfirmProvider>
            </TipProvider>
          ) : (
            <>
              {/* First, so a pairing link's token is stored before anything else asks. */}
              <PairingBootstrap />
              <TipProvider>
                <DesktopChrome />
                <ServiceConnection />
                <QuickCaptureHost />
                <WebAppBootstrap />
                <HomeReachabilityBanner />
                <HomeEnvironmentMarker />
                <ConfirmProvider>
                  <ArtifactPreviewProvider>
                    <LifecycleGuardProvider>{children}</LifecycleGuardProvider>
                  </ArtifactPreviewProvider>
                </ConfirmProvider>
              </TipProvider>
            </>
          )}
          <Toaster position="bottom-left" richColors closeButton />
        </QueryProvider>
      </body>
    </html>
  );
}
