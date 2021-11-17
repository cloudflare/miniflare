import { MiniflareError } from "@miniflare/shared";

export type CacheErrorCode =
  | "ERR_RESERVED" // Attempted to create cache with name "default"
  | "ERR_DESERIALIZATION"; // Unable to deserialize stored value (likely loading data created in Miniflare 1)

export class CacheError extends MiniflareError<CacheErrorCode> {}
