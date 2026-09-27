import { UpdateActionSchema, type UpdateAction } from './update-settings';

/** The updater owns its own busy lock. This closes the separate admission
 * gap while the controller transfers login supervision or awaits a body. */
export class ServiceControlCoordination {
  private reserved = false;
  constructor(private readonly updateBusy: () => boolean) {}
  get handingOff() { return this.reserved; }

  private assertUpdateAllowed() {
    if (this.reserved) throw new Error('Login supervision is being installed');
  }

  async dispatchUpdate<T>(request: AsyncIterable<Uint8Array>, dispatch: (action: UpdateAction) => T): Promise<T> {
    this.assertUpdateAllowed();
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 8192) throw new Error('Control request too large');
      chunks.push(chunk);
    }
    const action = UpdateActionSchema.parse(JSON.parse(Buffer.concat(chunks).toString()));
    // There is no await between this check and dispatch. A handoff may have
    // reserved admission while this request was still streaming its body.
    this.assertUpdateAllowed();
    return dispatch(action);
  }

  async handoff(operation: () => Promise<void>) {
    if (this.reserved || this.updateBusy()) throw new Error('Service management is already in progress');
    this.reserved = true;
    try {
      await operation();
      // Success has stopped the backend and queued process shutdown. Keep
      // admission closed until exit, including already-queued timer ticks.
    } catch (error) {
      this.reserved = false;
      throw error;
    }
  }

  async tick(run: () => Promise<void>) {
    if (!this.reserved) await run();
  }
}
