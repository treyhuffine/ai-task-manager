import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { QueryProvider } from "@/providers/query-provider";
import { PairingBootstrap } from "@/components/auth/pairing-bootstrap";
import { LifecycleGuardProvider } from "@/components/tasks/lifecycle-guard";
import "./globals.css";
import { APP_NAME } from "@/constants/app";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Productivity framework for humans and agents combined",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} dark`}>
      <body className="antialiased">
        <QueryProvider>
          <PairingBootstrap />
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
