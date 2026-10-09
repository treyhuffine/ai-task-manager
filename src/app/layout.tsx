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
import { WebAppBootstrap } from '@/components/settings/phone-install';
import { QuickCaptureHost } from '@/components/dashboard/quick-capture-host';
import { TeamRoot } from '@/components/team/team-root';
import { isTeamPage } from '@/lib/team/page-authority';

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
  // A team space is the same app with a different shell: no pairing, desktop
  // chrome, capture or personal banners, which all reach personal routes
  // (docs/homes-spec.md §3.2, §9.2).
  const team = await isTeamPage();
  return (
    <html lang="en" className={`${inter.variable} dark`} data-ri-authority={team ? 'team' : 'personal'}>
      <body className="antialiased">
        <QueryProvider>
          {team ? (
            <TipProvider>
              <ConfirmProvider>
                <TeamRoot>{children}</TeamRoot>
              </ConfirmProvider>
            </TipProvider>
          ) : (
            <>
              {/* First, so a pairing link's token is stored before anything else asks. */}
              <PairingBootstrap />
              <TipProvider>
                <DesktopChrome />
                <QuickCaptureHost />
                <WebAppBootstrap />
                <HomeReachabilityBanner />
                <HomeEnvironmentMarker />
                <ConfirmProvider>
                  <LifecycleGuardProvider>{children}</LifecycleGuardProvider>
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
