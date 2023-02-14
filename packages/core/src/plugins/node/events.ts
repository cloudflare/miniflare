import events from "node:events";

export default events;

export const EventEmitter = events.EventEmitter;
// @ts-expect-error `EventEmitterAsyncResource` is defined on `EventEmitter`
export const EventEmitterAsyncResource = events.EventEmitterAsyncResource;
export const captureRejectionSymbol = events.captureRejectionSymbol;
export const defaultMaxListeners = events.defaultMaxListeners;
export const errorMonitor = events.errorMonitor;
export const getEventListeners = events.getEventListeners;
export const listenerCount = events.listenerCount;
export const on = events.on;
export const once = events.once;
export const setMaxListeners = events.setMaxListeners;
