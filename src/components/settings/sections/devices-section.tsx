'use client';

import { RemoteBaseUrlSection } from '@/components/settings/remote-base-url';
import { DevicesSection } from '@/components/settings/devices-section';
import { ClientSettings } from '@/components/settings/client-settings';
import { PhoneInstall } from '@/components/settings/phone-install';
import { HostAvailability } from './host-availability';
import { DesktopControls } from '@/components/settings/desktop-controls';

/**
 * Devices pane. Desktop controls for the computer showing this window,
 * then the Home's remote base URL and paired-device management, then a
 * slim "This browser" block (host-machine identity + the host claim). Editor
 * and chat-density preferences moved to General.
 */
export function DevicesSettingsSection() {
  return (
    <div className="space-y-7">
      <DesktopControls />
      <RemoteBaseUrlSection />
      <HostAvailability />
      <DevicesSection />
      <PhoneInstall />
      <ClientSettings />
    </div>
  );
}
