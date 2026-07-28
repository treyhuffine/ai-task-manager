export default function WelcomeLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh w-full bg-background text-foreground">{children}</div>;
}
