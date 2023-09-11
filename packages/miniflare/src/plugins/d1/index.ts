import fs from "fs/promises";
import SCRIPT_D1_DATABASE_OBJECT from "worker:d1/database";
import { z } from "zod";
import {
  Service,
  Worker_Binding,
  Worker_Binding_DurableObjectNamespaceDesignator,
} from "../../runtime";
import { SharedBindings } from "../../workers";
import {
  PersistenceSchema,
  Plugin,
  SERVICE_LOOPBACK,
  getPersistPath,
  kProxyNodeBinding,
  migrateDatabase,
  namespaceEntries,
  namespaceKeys,
  objectEntryWorker,
} from "../shared";

export const D1OptionsSchema = z.object({
  d1Databases: z.union([z.record(z.string()), z.string().array()]).optional(),
});
export const D1SharedOptionsSchema = z.object({
  d1Persist: PersistenceSchema,
});

export const D1_PLUGIN_NAME = "d1";
const D1_STORAGE_SERVICE_NAME = `${D1_PLUGIN_NAME}:storage`;
const D1_DATABASE_SERVICE_PREFIX = `${D1_PLUGIN_NAME}:db`;
const D1_DATABASE_OBJECT_CLASS_NAME = "D1DatabaseObject";
const D1_DATABASE_OBJECT: Worker_Binding_DurableObjectNamespaceDesignator = {
  serviceName: D1_DATABASE_SERVICE_PREFIX,
  className: D1_DATABASE_OBJECT_CLASS_NAME,
};

export const D1_PLUGIN: Plugin<
  typeof D1OptionsSchema,
  typeof D1SharedOptionsSchema
> = {
  options: D1OptionsSchema,
  sharedOptions: D1SharedOptionsSchema,
  getBindings(options) {
    const databases = namespaceEntries(options.d1Databases);
    return databases.map<Worker_Binding>(([name, id]) => {
      const binding = name.startsWith("__D1_BETA__")
        ? // Used before Wrangler 3.3
          {
            service: { name: `${D1_DATABASE_SERVICE_PREFIX}:${id}` },
          }
        : // Used after Wrangler 3.3
          {
            wrapped: {
              moduleName: "cloudflare-internal:d1-api",
              innerBindings: [
                {
                  name: "fetcher",
                  service: { name: `${D1_DATABASE_SERVICE_PREFIX}:${id}` },
                },
              ],
            },
          };

      return { name, ...binding };
    });
  },
  getNodeBindings(options) {
    const databases = namespaceKeys(options.d1Databases);
    return Object.fromEntries(
      databases.map((name) => [name, kProxyNodeBinding])
    );
  },
  async getServices({ options, sharedOptions, tmpPath, log }) {
    const persist = sharedOptions.d1Persist;
    const databases = namespaceEntries(options.d1Databases);
    const services = databases.map<Service>(([_, id]) => ({
      name: `${D1_DATABASE_SERVICE_PREFIX}:${id}`,
      worker: objectEntryWorker(D1_DATABASE_OBJECT, id),
    }));

    if (databases.length > 0) {
      const uniqueKey = `miniflare-${D1_DATABASE_OBJECT_CLASS_NAME}`;
      const persistPath = getPersistPath(D1_PLUGIN_NAME, tmpPath, persist);
      await fs.mkdir(persistPath, { recursive: true });

      const storageService: Service = {
        name: D1_STORAGE_SERVICE_NAME,
        disk: { path: persistPath, writable: true },
      };
      const objectService: Service = {
        name: D1_DATABASE_SERVICE_PREFIX,
        worker: {
          compatibilityDate: "2023-07-24",
          compatibilityFlags: ["nodejs_compat", "experimental"],
          modules: [
            {
              name: "database.worker.js",
              esModule: SCRIPT_D1_DATABASE_OBJECT(),
            },
          ],
          durableObjectNamespaces: [
            {
              className: D1_DATABASE_OBJECT_CLASS_NAME,
              uniqueKey,
            },
          ],
          // Store Durable Object SQL databases in persist path
          durableObjectStorage: { localDisk: D1_STORAGE_SERVICE_NAME },
          // Bind blob disk directory service to object
          bindings: [
            {
              name: SharedBindings.MAYBE_SERVICE_BLOBS,
              service: { name: D1_STORAGE_SERVICE_NAME },
            },
            {
              name: SharedBindings.MAYBE_SERVICE_LOOPBACK,
              service: { name: SERVICE_LOOPBACK },
            },
          ],
        },
      };
      services.push(storageService, objectService);

      for (const database of databases) {
        await migrateDatabase(log, uniqueKey, persistPath, database[1]);
      }
    }

    return services;
  },
};
