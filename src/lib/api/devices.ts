import { trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';
import type { RouterInputs, RouterOutputs } from '@/lib/trpc/router';

/** A key a device signs in with, without its secret. */
export type DeviceKeyView = RouterOutputs['devices']['list'][number]['keys'][number];

/** A device of this home, as `GET /api/devices` gives it. */
export type DeviceView = RouterOutputs['devices']['list'][number];

export type PairDeviceBody = RouterInputs['devices']['create']['body'];

/** A new pairing: the device and the key's token, shown once. */
export type PairDeviceResponse = RouterOutputs['devices']['create'];

export type UpdateDeviceBody = RouterInputs['devices']['update']['body'];

export const devicesApi = {
  list(opts?: { includeRevoked?: boolean }) {
    return trpcClient.devices.list.query({query: rpcQuery(opts?.includeRevoked ? { includeRevoked: 1 } : undefined)});
  },

  pair(input: PairDeviceBody) {
    return trpcClient.devices.create.mutate({body: input});
  },

  update(id: string, input: UpdateDeviceBody) {
    return trpcClient.devices.update.mutate({params: {id: id}, body: input});
  },

  /** Remove a device: every key it has stops working, and its worker with them. */
  remove(id: string) {
    return trpcClient.devices.delete.mutate({params: {id: id}});
  },

  /** A new pairing link for a device already here. */
  addKey(id: string) {
    return trpcClient.devices.keysPost.mutate({params: {id: id}, body: {}});
  },

  revokeKey(id: string, keyId: string) {
    return trpcClient.devices.keysKeyIdDelete.mutate({params: {id: id, keyId: keyId}});
  },
};
