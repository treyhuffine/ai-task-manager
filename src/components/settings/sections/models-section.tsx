'use client';

import { HarnessSettingsPanel } from '@/components/settings/harness-settings-panel';
import { BillingSection } from './billing-section';

/**
 * Default agent provider/model (reuses HarnessSettingsPanel), and usage and
 * budget. The main chat's Skills / MCP choice that used to sit here was
 * retired on 2026-10-05: it acts through MCP only.
 */
export function ModelsSection() {
  return (
    <div className="space-y-7">
      <HarnessSettingsPanel />

      <section className="space-y-3 text-[12px]">
        <header className="space-y-0.5">
          <h3 className="text-[13px] font-semibold text-foreground">Usage &amp; budget</h3>
          <p className="text-[11px] text-muted-foreground/85">
            What your agents have spent, and an optional monthly cap.
          </p>
        </header>
        <BillingSection />
      </section>
    </div>
  );
}
