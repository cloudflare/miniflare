export const SharedHeaders = {
  LOG_LEVEL: "MF-Log-Level",
} as const;

export const SharedBindings = {
  TEXT_NAMESPACE: "MINIFLARE_NAMESPACE",
  DURABLE_OBJECT_NAMESPACE_OBJECT: "MINIFLARE_OBJECT",
  MAYBE_SERVICE_BLOBS: "MINIFLARE_BLOBS",
  MAYBE_SERVICE_LOOPBACK: "MINIFLARE_LOOPBACK",
} as const;

export enum LogLevel {
  NONE,
  ERROR,
  WARN,
  INFO,
  DEBUG,
  VERBOSE,
}
