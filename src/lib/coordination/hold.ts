/** A durable reservation waiting for explicit release, not a failed assignment. */
export class CoordinationHeldError extends Error {
  constructor() { super('Hold is on for this chat. Incoming messages remain visible and wait for release.'); this.name = 'CoordinationHeldError'; }
}
