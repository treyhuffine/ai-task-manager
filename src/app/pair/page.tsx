import { APP_NAME } from '@/constants/app';

export const dynamic = 'force-static';

export default function PairPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-lg w-full space-y-6 text-foreground">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{APP_NAME}</p>
          <h1 className="text-2xl font-semibold">Not paired</h1>
          <p className="text-sm text-muted-foreground">
            This browser doesn&rsquo;t have a {APP_NAME} token. Pair it to continue.
          </p>
        </header>

        <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
          <h2 className="font-medium">On the host machine</h2>
          <ol className="space-y-2 list-decimal list-inside text-muted-foreground">
            <li>
              Run <code className="font-mono text-foreground">pnpm auth:pair</code> in your terminal.
            </li>
            <li>Copy the printed URL (it contains your token after <code className="font-mono text-foreground">#t=</code>).</li>
            <li>Open that URL here. The fragment is consumed on load and this browser is paired.</li>
          </ol>
        </section>

        <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
          <h2 className="font-medium">Add another device</h2>
          <p className="text-muted-foreground">
            From a paired browser, open <strong>Profile &rarr; Devices</strong> and create a new device.
            Share the generated link with the target device.
          </p>
        </section>

        <p className="text-xs text-muted-foreground">
          Tokens are stored in this browser&rsquo;s localStorage. Clear it to sign out.
        </p>
      </div>
    </div>
  );
}
