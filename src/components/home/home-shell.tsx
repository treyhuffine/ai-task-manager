import type { ReactNode } from 'react';

/** Shared document chrome. A route supplies destinations and contextual controls. */
export function HomeShell({ header, navigation, phoneHeader, phoneNavigation, overlays, children }: {
  header?: ReactNode;
  navigation?: ReactNode;
  phoneHeader?: ReactNode;
  phoneNavigation?: ReactNode;
  overlays?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background font-sans text-foreground antialiased transition-colors duration-300">
      {header}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {navigation}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {phoneHeader && <div className="md:hidden">{phoneHeader}</div>}
          {children}
          {phoneNavigation && <div className="md:hidden">{phoneNavigation}</div>}
        </main>
      </div>
      {overlays}
    </div>
  );
}
