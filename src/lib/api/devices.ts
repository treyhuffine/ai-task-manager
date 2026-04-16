import { api } from './client';
import type { ApiKeyRecord, DeviceType } from '@/db/types';

export interface CreateDeviceBody {
  name: string;
  description?: string | null;
  device_type?: DeviceType;
  expires_at?: string | null;
}

export interface CreateDeviceResponse {
  key: ApiKeyRecord;
  plaintext: string;
}

export const devicesApi = {
  list(opts?: { includeRevoked?: boolean }): Promise<ApiKeyRecord[]> {
    return api.get<ApiKeyRecord[]>('/devices', opts?.includeRevoked ? { include_revoked: 1 } : undefined);
  },

  create(input: CreateDeviceBody): Promise<CreateDeviceResponse> {
    return api.post<CreateDeviceResponse>('/devices', input);
  },

  revoke(id: string, reason?: string): Promise<void> {
    const suffix = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    return api.delete(`/devices/${id}${suffix}`);
  },
};
