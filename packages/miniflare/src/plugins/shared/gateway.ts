import crypto from "crypto";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { URLSearchParams, fileURLToPath } from "url";
import type { IncomingRequestCfProperties } from "@cloudflare/workers-types/experimental";
import { z } from "zod";
import { RequestInfo, RequestInit, Response } from "../../http";
import { Log, MiniflareCoreError, Timers } from "../../shared";
import { Storage, createFileStorage, createMemoryStorage } from "../../storage";
import { Awaitable, sanitisePath } from "../../workers";

// TODO: explain why persist passed as header, want options set to be atomic,
//  if set gateway before script update, may be using new persist before new script
export const PersistenceSchema = z.boolean().or(z.string()).optional();
export type Persistence = z.infer<typeof PersistenceSchema>;

export type DispatchFetch = (
  input: RequestInfo,
  init?: RequestInit<Partial<IncomingRequestCfProperties>>
) => Promise<Response>;

export const CloudflareFetchSchema =
  // TODO(soon): figure out a way to do optional parameters with z.function()
  z.custom<
    (
      resource: string,
      searchParams?: URLSearchParams,
      init?: RequestInit
    ) => Awaitable<Response>
  >();
export type CloudflareFetch = z.infer<typeof CloudflareFetchSchema>;

export interface GatewayConstructor<Gateway> {
  new (
    log: Log,
    storage: Storage,
    timers: Timers,
    namespace: string,
    dispatchFetch: DispatchFetch
  ): Gateway;
}

export const DEFAULT_PERSIST_ROOT = ".mf";

export function getPersistPath(
  pluginName: string,
  tmpPath: string,
  persist: Persistence
): string {
  // If persistence is disabled, use "memory" storage. Note we're still
  // returning a path on the file-system here. Miniflare 2's in-memory storage
  // persisted between options reloads. However, we restart the `workerd`
  // process on each reload which would destroy any in-memory data. We'd like to
  // keep Miniflare 2's behaviour, so persist to a temporary path which we
  // destroy on `dispose()`.
  const memoryishPath = path.join(tmpPath, pluginName);
  if (persist === undefined || persist === false) {
    return memoryishPath;
  }

  // Try parse `persist` as a URL
  const url = maybeParseURL(persist);
  if (url !== undefined) {
    if (url.protocol === "memory:") {
      return memoryishPath;
    } else if (url.protocol === "file:") {
      // TODO: deprecate/remove `PARAM_FILE_UNSANITISE`
      return fileURLToPath(url);
    }
    // TODO: deprecate/remove `sqlite:` and `remote:`
    throw new MiniflareCoreError(
      "ERR_PERSIST_UNSUPPORTED",
      `Unsupported "${url.protocol}" persistence protocol for storage: ${url.href}`
    );
  }

  // Otherwise, fallback to file storage
  return persist === true
    ? path.join(DEFAULT_PERSIST_ROOT, pluginName)
    : persist;
}

// https://github.com/cloudflare/workerd/blob/81d97010e44f848bb95d0083e2677bca8d1658b7/src/workerd/server/workerd-api.c%2B%2B#L436
function durableObjectNamespaceIdFromName(uniqueKey: string, name: string) {
  const key = crypto.createHash("sha256").update(uniqueKey).digest();
  const nameHmac = crypto
    .createHmac("sha256", key)
    .update(name)
    .digest()
    .subarray(0, 16);
  const hmac = crypto
    .createHmac("sha256", key)
    .update(nameHmac)
    .digest()
    .subarray(0, 16);
  return Buffer.concat([nameHmac, hmac]).toString("hex");
}

export async function migrateDatabase(
  log: Log,
  uniqueKey: string,
  persistPath: string,
  namespace: string
) {
  // Check if database exists at previous location
  const sanitisedNamespace = sanitisePath(namespace);
  const previousDir = path.join(persistPath, sanitisedNamespace);
  const previousPath = path.join(previousDir, "db.sqlite");
  const previousShmPath = path.join(previousDir, "db.sqlite-shm");
  const previousWalPath = path.join(previousDir, "db.sqlite-wal");
  if (!existsSync(previousPath)) {
    return;
  }

  // Move database to new location, if database isn't already there
  const id = durableObjectNamespaceIdFromName(uniqueKey, namespace);
  const newDir = path.join(persistPath, uniqueKey);
  const newPath = path.join(newDir, `${id}.sqlite`);
  const newShmPath = path.join(newDir, `${id}.sqlite-shm`);
  const newWalPath = path.join(newDir, `${id}.sqlite-wal`);
  if (existsSync(newPath)) {
    log.debug(
      `Not migrating ${previousPath} to ${newPath} as it already exists`
    );
    return;
  }

  log.debug(`Migrating ${previousPath} to ${newPath}...`);
  await fs.mkdir(newDir, { recursive: true });

  try {
    await fs.copyFile(previousPath, newPath);
    if (existsSync(previousShmPath)) {
      await fs.copyFile(previousShmPath, newShmPath);
    }
    if (existsSync(previousWalPath)) {
      await fs.copyFile(previousWalPath, newWalPath);
    }
    await fs.unlink(previousPath);
    await fs.unlink(previousShmPath);
    await fs.unlink(previousWalPath);
  } catch (e) {
    log.warn(`Error migrating ${previousPath} to ${newPath}: ${e}`);
  }
}

export const PARAM_FILE_UNSANITISE = "unsanitise";

export function maybeParseURL(url: Persistence): URL | undefined {
  if (typeof url !== "string" || path.isAbsolute(url)) return;
  try {
    return new URL(url);
  } catch {}
}

export class GatewayFactory<Gateway> {
  readonly #memoryStorages = new Map<string, Storage>();
  readonly #gateways = new Map<string, [Persistence, Gateway]>();

  constructor(
    private readonly log: Log,
    private readonly timers: Timers,
    private readonly dispatchFetch: DispatchFetch,
    private readonly pluginName: string,
    private readonly gatewayClass: GatewayConstructor<Gateway>
  ) {}

  #getMemoryStorage(namespace: string) {
    let storage = this.#memoryStorages.get(namespace);
    if (storage !== undefined) return storage;
    this.#memoryStorages.set(namespace, (storage = createMemoryStorage()));
    return storage;
  }

  getStorage(namespace: string, persist: Persistence): Storage {
    // If persistence is disabled, use memory storage
    if (persist === undefined || persist === false) {
      return this.#getMemoryStorage(namespace);
    }

    // Sanitise namespace to make it file-system safe
    const sanitisedNamespace = sanitisePath(namespace);

    // Try parse `persist` as a URL
    const url = maybeParseURL(persist);
    if (url !== undefined) {
      if (url.protocol === "memory:") {
        return this.#getMemoryStorage(namespace);
      }
      if (url.protocol === "file:") {
        const root = path.join(fileURLToPath(url), sanitisedNamespace);
        return createFileStorage(root);
      }
      throw new MiniflareCoreError(
        "ERR_PERSIST_UNSUPPORTED",
        `Unsupported "${url.protocol}" persistence protocol for storage: ${url.href}`
      );
    }

    // Otherwise, fallback to file storage
    const root =
      persist === true
        ? path.join(DEFAULT_PERSIST_ROOT, this.pluginName, sanitisedNamespace)
        : path.join(persist, sanitisedNamespace);
    return createFileStorage(root);
  }

  get(namespace: string, persist: Persistence): Gateway {
    const cached = this.#gateways.get(namespace);
    if (cached !== undefined && cached[0] === persist) return cached[1];

    const storage = this.getStorage(namespace, persist);
    const gateway = new this.gatewayClass(
      this.log,
      storage,
      this.timers,
      namespace,
      this.dispatchFetch
    );
    this.#gateways.set(namespace, [persist, gateway]);
    return gateway;
  }
}
