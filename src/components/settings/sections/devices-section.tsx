'use client';

import { RemoteBaseUrlSection } from '@/components/settings/remote-base-url';
import { DevicesSection } from '@/components/settings/devices-section';
import { ClientSettings } from '@/components/settings/client-settings';

/**
 * Devices pane. Remote base URL first (it's the most-reached-for setting —
 * the URL other devices pair against), then paired-device management, then a
 * slim "This browser" block (host-machine identity + the host claim). Editor
 * and chat-density preferences moved to General.
 */
export function DevicesSettingsSection() {
  return (
    <div className="space-y-7">
      <RemoteBaseUrlSection />
      <DevicesSection />
      <ClientSettings />
    </div>
  );
}
