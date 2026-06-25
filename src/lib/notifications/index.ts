/**
 * The Notifier — the app's push layer over connectors (spec §2). One-way dependency on connectors;
 * the engine never hears the word "channel". Public surface: `notify()` + the event catalog + types.
 */
export { notify } from './notify';
export type { NotifyOptions } from './notify';
export {
  EVENT_CATALOG,
  MATRIX_EVENT_TYPES,
  defaultChannelEvents,
  eventCatalogEntry,
} from './events';
export type { NotificationEventType, EventCatalogEntry } from './events';
export type { NotificationEvent, RenderedNotification, NotificationChannelAdapter, DeliveryResult } from './types';
export { NOTIFIER_CALLER, NOTIFIER_DELIVERY_ACTIONS, isNotifierDelivery } from './caller';
