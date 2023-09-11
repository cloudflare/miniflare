import fs from "fs/promises";
import SCRIPT_R2_BUCKET_OBJECT from "worker:r2/bucket";
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

export const R2OptionsSchema = z.object({
  r2Buckets: z.union([z.record(z.string()), z.string().array()]).optional(),
});
export const R2SharedOptionsSchema = z.object({
  r2Persist: PersistenceSchema,
});

export const R2_PLUGIN_NAME = "r2";
const R2_STORAGE_SERVICE_NAME = `${R2_PLUGIN_NAME}:storage`;
const R2_BUCKET_SERVICE_PREFIX = `${R2_PLUGIN_NAME}:bucket`;
const R2_BUCKET_OBJECT_CLASS_NAME = "R2BucketObject";
const R2_BUCKET_OBJECT: Worker_Binding_DurableObjectNamespaceDesignator = {
  serviceName: R2_BUCKET_SERVICE_PREFIX,
  className: R2_BUCKET_OBJECT_CLASS_NAME,
};

export const R2_PLUGIN: Plugin<
  typeof R2OptionsSchema,
  typeof R2SharedOptionsSchema
> = {
  options: R2OptionsSchema,
  sharedOptions: R2SharedOptionsSchema,
  getBindings(options) {
    const buckets = namespaceEntries(options.r2Buckets);
    return buckets.map<Worker_Binding>(([name, id]) => ({
      name,
      r2Bucket: { name: `${R2_BUCKET_SERVICE_PREFIX}:${id}` },
    }));
  },
  getNodeBindings(options) {
    const buckets = namespaceKeys(options.r2Buckets);
    return Object.fromEntries(buckets.map((name) => [name, kProxyNodeBinding]));
  },
  async getServices({ options, sharedOptions, tmpPath, log }) {
    const persist = sharedOptions.r2Persist;
    const buckets = namespaceEntries(options.r2Buckets);
    const services = buckets.map<Service>(([_, id]) => ({
      name: `${R2_BUCKET_SERVICE_PREFIX}:${id}`,
      worker: objectEntryWorker(R2_BUCKET_OBJECT, id),
    }));

    if (buckets.length > 0) {
      const uniqueKey = `miniflare-${R2_BUCKET_OBJECT_CLASS_NAME}`;
      const persistPath = getPersistPath(R2_PLUGIN_NAME, tmpPath, persist);
      await fs.mkdir(persistPath, { recursive: true });
      const storageService: Service = {
        name: R2_STORAGE_SERVICE_NAME,
        disk: { path: persistPath, writable: true },
      };
      const objectService: Service = {
        name: R2_BUCKET_SERVICE_PREFIX,
        worker: {
          compatibilityDate: "2023-07-24",
          compatibilityFlags: ["nodejs_compat", "experimental"],
          modules: [
            {
              name: "bucket.worker.js",
              esModule: SCRIPT_R2_BUCKET_OBJECT(),
            },
          ],
          durableObjectNamespaces: [
            {
              className: R2_BUCKET_OBJECT_CLASS_NAME,
              uniqueKey,
            },
          ],
          // Store Durable Object SQL databases in persist path
          durableObjectStorage: { localDisk: R2_STORAGE_SERVICE_NAME },
          // Bind blob disk directory service to object
          bindings: [
            {
              name: SharedBindings.MAYBE_SERVICE_BLOBS,
              service: { name: R2_STORAGE_SERVICE_NAME },
            },
            {
              name: SharedBindings.MAYBE_SERVICE_LOOPBACK,
              service: { name: SERVICE_LOOPBACK },
            },
          ],
        },
      };
      services.push(storageService, objectService);

      for (const bucket of buckets) {
        await migrateDatabase(log, uniqueKey, persistPath, bucket[1]);
      }
    }

    return services;
  },
};
