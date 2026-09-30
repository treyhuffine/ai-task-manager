import type { MenuItemConstructorOptions } from 'electron';
import type { ServiceStatus } from '../src/lib/service/client';

export function localDeviceMenu(status: ServiceStatus | undefined, control: (action: 'stop' | 'resume') => void): MenuItemConstructorOptions[] {
  if (!status) return [];
  if (status.role === 'viewer') return [{ id: 'ri-local-device', label: 'This device: viewer only', enabled: false }];
  if (status.role !== 'worker') return [];
  const worker = status.worker;
  return [
    { id: 'ri-local-device', label: `Local execution: ${worker?.state ?? 'starting'}`, enabled: false },
    ...(worker?.activity ?? []).slice(0, 3).map((label, index) => ({ id: `ri-local-work-${index}`, label: label.replaceAll('&', '&&'), enabled: false })),
    { id: 'ri-local-execution-control', label: worker?.enabled === false ? 'Resume Local Execution' : 'Stop Local Execution', click: () => control(worker?.enabled === false ? 'resume' : 'stop') },
    { type: 'separator' },
  ];
}
