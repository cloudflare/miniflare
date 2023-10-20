import crypto from "crypto";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { Service, Worker_Binding, Worker_Module } from "../../runtime";
import { Log, MiniflareCoreError, OptionalZodTypeOf } from "../../shared";
import { Awaitable, QueueConsumerSchema, sanitisePath } from "../../workers";

export const DEFAULT_PERSIST_ROOT = ".mf";

export const PersistenceSchema = z.boolean().or(z.string()).optional();
export type Persistence = z.infer<typeof PersistenceSchema>;

// Maps **service** names to the Durable Object class names exported by them
export type DurableObjectClassNames = Map<
  string,
  Map</* className */ string, /* unsafeUniqueKey */ string | undefined>
>;

// Maps queue names to the Worker that wishes to consume it. Note each queue
// can only be consumed by one Worker, but one Worker may consume multiple
// queues. Support for multiple consumers of a single queue is not planned
// anytime soon.
export type QueueConsumers = Map<string, z.infer<typeof QueueConsumerSchema>>;

export interface PluginServicesOptions<
  Options extends z.ZodType,
  SharedOptions extends z.ZodType | undefined
> {
  log: Log;
  options: z.infer<Options>;
  sharedOptions: OptionalZodTypeOf<SharedOptions>;
  workerBindings: Worker_Binding[];
  workerIndex: number;
  additionalModules: Worker_Module[];
  tmpPath: string;
  workerNames: string[];

  // ~~Leaky abstractions~~ "Plugin specific options" :)
  durableObjectClassNames: DurableObjectClassNames;
  unsafeEphemeralDurableObjects: boolean;
  queueConsumers: QueueConsumers;
}

export interface PluginBase<
  Options extends z.ZodType,
  SharedOptions extends z.ZodType | undefined
> {
  options: Options;
  getBindings(
    options: z.infer<Options>,
    workerIndex: number
  ): Awaitable<Worker_Binding[] | void>;
  getNodeBindings(
    options: z.infer<Options>
  ): Awaitable<Record<string, unknown>>;
  getServices(
    options: PluginServicesOptions<Options, SharedOptions>
  ): Awaitable<Service[] | void>;
}

export type Plugin<
  Options extends z.ZodType,
  SharedOptions extends z.ZodType | undefined = undefined
> = PluginBase<Options, SharedOptions> &
  (SharedOptions extends undefined
    ? { sharedOptions?: undefined }
    : { sharedOptions: SharedOptions });

// When this is returned as the binding from `PluginBase#getNodeBindings()`,
// Miniflare will replace it with a proxy to the binding in `workerd`
export const kProxyNodeBinding = Symbol("kProxyNodeBinding");

export function namespaceKeys(
  namespaces?: Record<string, string> | string[]
): string[] {
  if (Array.isArray(namespaces)) {
    return namespaces;
  } else if (namespaces !== undefined) {
    return Object.keys(namespaces);
  } else {
    return [];
  }
}

export function namespaceEntries(
  namespaces?: Record<string, string> | string[]
): [bindingName: string, id: string][] {
  if (Array.isArray(namespaces)) {
    return namespaces.map((bindingName) => [bindingName, bindingName]);
  } else if (namespaces !== undefined) {
    return Object.entries(namespaces);
  } else {
    return [];
  }
}

export function maybeParseURL(url: Persistence): URL | undefined {
  if (typeof url !== "string" || path.isAbsolute(url)) return;
  try {
    return new URL(url);
  } catch {}
}

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
      return fileURLToPath(url);
    }
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
  const previousWalPath = path.join(previousDir, "db.sqlite-wal");
  if (!existsSync(previousPath)) return;

  // Move database to new location, if database isn't already there
  const id = durableObjectNamespaceIdFromName(uniqueKey, namespace);
  const newDir = path.join(persistPath, uniqueKey);
  const newPath = path.join(newDir, `${id}.sqlite`);
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
    if (existsSync(previousWalPath)) {
      await fs.copyFile(previousWalPath, newWalPath);
    }
    await fs.unlink(previousPath);
    await fs.unlink(previousWalPath);
  } catch (e) {
    log.warn(`Error migrating ${previousPath} to ${newPath}: ${e}`);
  }
}

export * from "./constants";
export * from "./routing";
