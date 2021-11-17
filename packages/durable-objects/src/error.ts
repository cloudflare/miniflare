import { MiniflareError } from "@miniflare/shared";

export type DurableObjectErrorCode =
  | "ERR_SCRIPT_NOT_FOUND" // Missing mounted script for object
  | "ERR_CLASS_NOT_FOUND" // Missing constructor for object
  | "ERR_RESPONSE_TYPE" // Fetch handler returned non-Response object;
  | "ERR_DESERIALIZATION"; // Unable to deserialize stored value (likely loading data created in Miniflare 1)

export class DurableObjectError extends MiniflareError<DurableObjectErrorCode> {}
