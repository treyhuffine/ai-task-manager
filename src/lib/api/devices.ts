import { api } from './client';
import type { ApiKeyRecord, DeviceType } from '@/db/types';

export interface CreateDeviceBody {
  name: string;
  description?: string | null;
  deviceType?: DeviceType;
  expiresAt?: string | null;
}

export interface CreateDeviceResponse {
  key: ApiKeyRecord;
  plaintext: string;
}

export interface UpdateDeviceBody {
  name?: string;
  description?: string | null;
  deviceType?: DeviceType;
}

export const devicesApi = {
  list(opts?: { includeRevoked?: boolean }): Promise<ApiKeyRecord[]> {
    return api.get<ApiKeyRecord[]>('/devices', {
      query: opts?.includeRevoked ? { include_revoked: 1 } : undefined,
    });
  },

  create(input: CreateDeviceBody): Promise<CreateDeviceResponse> {
    return api.post<CreateDeviceResponse>('/devices', input);
  },

  update(id: string, input: UpdateDeviceBody): Promise<ApiKeyRecord> {
    return api.patch<ApiKeyRecord>(`/devices/${id}`, input);
  },

  revoke(id: string, reason?: string): Promise<void> {
    return api.delete(`/devices/${id}`, { query: reason ? { reason } : undefined });
  },
};
