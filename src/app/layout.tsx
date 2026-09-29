import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { QueryProvider } from "@/providers/query-provider";
import { PairingBootstrap } from "@/components/auth/pairing-bootstrap";
import { HomeReachabilityBanner } from "@/components/app/home-reachability-banner";
import { LifecycleGuardProvider } from "@/components/tasks/lifecycle-guard";
import "./globals.css";
import { APP_NAME } from "@/constants/app";
import { DesktopChrome } from '@/components/desktop/desktop-chrome';
import { WebAppBootstrap } from '@/components/settings/phone-install';
import { QuickCaptureHost } from '@/components/dashboard/quick-capture-host';

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Productivity framework for humans and agents combined",
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: 'default' },
};

export const viewport: Viewport = { themeColor: '#181a18' };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} dark`}>
      <body className="antialiased">
        <QueryProvider>
          {/* First, so a pairing link's token is stored before anything else asks. */}
          <PairingBootstrap />
          <DesktopChrome />
          <QuickCaptureHost />
          <WebAppBootstrap />
          <HomeReachabilityBanner />
          <TooltipProvider>
            <ConfirmProvider>
              <LifecycleGuardProvider>{children}</LifecycleGuardProvider>
            </ConfirmProvider>
          </TooltipProvider>
          <Toaster position="bottom-left" richColors closeButton />
        </QueryProvider>
      </body>
    </html>
  );
}
