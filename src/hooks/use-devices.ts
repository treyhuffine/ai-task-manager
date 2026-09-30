import { useQuery } from '@tanstack/react-query';
import { devicesApi, type DeviceView } from '@/lib/api/devices';

export type { DeviceView };

/** This home's devices. Settings, Devices and the imports panel share the cache. */
export function useDevices() {
  return useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.list(),
    staleTime: 30_000,
  });
}

/** One device of this home, from the same list. */
export function useDevice(id: string | null | undefined): DeviceView | null {
  const { data } = useDevices();
  return (id && data?.find((c) => c.id === id)) || null;
}

/**
 * Whether work here can run on more than one device: the home and at least
 * one enrolled worker. Only then is where an execution runs worth saying
 * (P3.1). A one-device home shows nothing new.
 */
export function useRunsOnSeveralDevices(): boolean {
  const { data } = useDevices();
  return (data ?? []).filter((d) => d.runsAgents).length > 1;
}

/**
 * The home's device when it's a laptop, else null. Schedules run on the
 * home, so on a laptop they run only while it's awake, and the schedule
 * screens say so (P3.4, spec §7).
 */
export function useLaptopHome(): DeviceView | null {
  const { data } = useDevices();
  return data?.find((c) => c.isHome && c.portable) ?? null;
}

/**
 * The device this browser signs in from, as the home knows it: its key's
 * device. A browser linked with "This Mac" (P2.2) is on that computer's
 * device. The home checks it again on every open.
 */
export function useThisDevice(): DeviceView | null {
  const { data } = useDevices();
  return data?.find((d) => d.isThisDevice) ?? null;
}
