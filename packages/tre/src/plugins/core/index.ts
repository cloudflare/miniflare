import { readFileSync } from "fs";
import fs from "fs/promises";
import { TextEncoder } from "util";
import { bold } from "kleur/colors";
import { z } from "zod";
import {
  Service,
  Worker_Binding,
  Worker_Module,
  kVoid,
  supportedCompatibilityDate,
} from "../../runtime";
import { Awaitable, JsonSchema, Log, MiniflareCoreError } from "../../shared";
import { getCacheServiceName } from "../cache";
import {
  BINDING_SERVICE_LOOPBACK,
  CloudflareFetchSchema,
  HEADER_CF_BLOB,
  Plugin,
} from "../shared";
import { HEADER_ERROR_STACK } from "./errors";
import {
  ModuleDefinitionSchema,
  ModuleLocator,
  ModuleRuleSchema,
  buildStringScriptPath,
  convertModuleDefinition,
} from "./modules";
import { ServiceDesignatorSchema } from "./services";

const encoder = new TextEncoder();
const numericCompare = new Intl.Collator(undefined, { numeric: true }).compare;

export const CoreOptionsSchema = z.object({
  name: z.string().optional(),
  script: z.string().optional(),
  scriptPath: z.string().optional(),
  modules: z
    .union([
      // Automatically collect modules by parsing `script`/`scriptPath`...
      z.boolean(),
      // ...or manually define modules
      // (used by Wrangler which has its own module collection code)
      z.array(ModuleDefinitionSchema),
    ])
    .optional(),
  modulesRoot: z.string().optional(),
  modulesRules: z.array(ModuleRuleSchema).optional(),

  compatibilityDate: z.string().optional(),
  compatibilityFlags: z.string().array().optional(),

  bindings: z.record(JsonSchema).optional(),
  wasmBindings: z.record(z.string()).optional(),
  textBlobBindings: z.record(z.string()).optional(),
  dataBlobBindings: z.record(z.string()).optional(),
  serviceBindings: z.record(ServiceDesignatorSchema).optional(),
});

export const CoreSharedOptionsSchema = z.object({
  host: z.string().optional(),
  port: z.number().optional(),

  inspectorPort: z.number().optional(),
  verbose: z.boolean().optional(),

  log: z.instanceof(Log).optional(),
  clock: z.function().returns(z.number()).optional(),
  cloudflareFetch: CloudflareFetchSchema.optional(),

  // TODO: add back validation of cf object
  cf: z.union([z.boolean(), z.string(), z.record(z.any())]).optional(),

  liveReload: z.boolean().optional(),
});

export const CORE_PLUGIN_NAME = "core";

// Service looping back to Miniflare's Node.js process (for storage, etc)
export const SERVICE_LOOPBACK = `${CORE_PLUGIN_NAME}:loopback`;
// Service for HTTP socket entrypoint (for checking runtime ready, routing, etc)
export const SERVICE_ENTRY = `${CORE_PLUGIN_NAME}:entry`;
// Service prefix for all regular user workers
const SERVICE_USER_PREFIX = `${CORE_PLUGIN_NAME}:user`;
// Service prefix for `workerd`'s builtin services (network, external, disk)
const SERVICE_BUILTIN_PREFIX = `${CORE_PLUGIN_NAME}:builtin`;
// Service prefix for custom fetch functions defined in `serviceBindings` option
const SERVICE_CUSTOM_PREFIX = `${CORE_PLUGIN_NAME}:custom`;

export function getUserServiceName(workerName = "") {
  return `${SERVICE_USER_PREFIX}:${workerName}`;
}
function getBuiltinServiceName(workerIndex: number, bindingName: string) {
  return `${SERVICE_BUILTIN_PREFIX}:${workerIndex}:${bindingName}`;
}
function getCustomServiceName(workerIndex: number, bindingName: string) {
  return `${SERVICE_CUSTOM_PREFIX}:${workerIndex}:${bindingName}`;
}

export const HEADER_PROBE = "MF-Probe";
export const HEADER_CUSTOM_SERVICE = "MF-Custom-Service";
export const HEADER_ORIGINAL_URL = "MF-Original-URL";

const BINDING_JSON_VERSION = "MINIFLARE_VERSION";
const BINDING_SERVICE_USER = "MINIFLARE_USER";
const BINDING_TEXT_CUSTOM_SERVICE = "MINIFLARE_CUSTOM_SERVICE";
const BINDING_JSON_CF_BLOB = "CF_BLOB";
const BINDING_DATA_LIVE_RELOAD_SCRIPT = "MINIFLARE_LIVE_RELOAD_SCRIPT";

const LIVE_RELOAD_SCRIPT_TEMPLATE = (
  port: number
) => `<script defer type="application/javascript">
(function () {
  // Miniflare Live Reload
  var url = new URL("/cdn-cgi/mf/reload", location.origin);
  url.protocol = url.protocol.replace("http", "ws");
  url.port = ${port};
  function reload() { location.reload(); }
  function connect(reconnected) {
    var ws = new WebSocket(url);
    if (reconnected) ws.onopen = reload;
    ws.onclose = function(e) {
      e.code === 1012 ? reload() : e.code === 1000 || e.code === 1001 || setTimeout(connect, 1000, true);
    }
  }
  connect();
})();
</script>`;

// Using `>=` for version check to handle multiple `setOptions` calls before
// reload complete.
export const SCRIPT_ENTRY = `async function handleEvent(event) {
  const probe = event.request.headers.get("${HEADER_PROBE}");
  if (probe !== null) {
    const probeMin = parseInt(probe);
    const status = ${BINDING_JSON_VERSION} >= probeMin ? 204 : 412;
    return new Response(null, { status });
  }

  const originalUrl = event.request.headers.get("${HEADER_ORIGINAL_URL}");
  const request = new Request(originalUrl ?? event.request.url, {
    method: event.request.method,
    headers: event.request.headers,
    cf: event.request.cf ?? ${BINDING_JSON_CF_BLOB},
    redirect: event.request.redirect,
    body: event.request.body,
  });
  request.headers.delete("${HEADER_ORIGINAL_URL}");

  if (globalThis.${BINDING_SERVICE_USER} === undefined) {
    return new Response("No entrypoint worker found", { status: 404 });
  }
  try {
    let response = await ${BINDING_SERVICE_USER}.fetch(request);
    
    if (
      response.status === 500 &&
      response.headers.get("${HEADER_ERROR_STACK}") !== null
    ) {
      const accept = request.headers.get("Accept")?.toLowerCase() ?? "";
      const userAgent = request.headers.get("User-Agent")?.toLowerCase() ?? "";
      const acceptsPrettyError =
        !userAgent.includes("curl/") &&
        (accept.includes("text/html") ||
          accept.includes("*/*") ||
          accept.includes("text/*"));
      if (acceptsPrettyError) {
        response = await ${BINDING_SERVICE_LOOPBACK}.fetch("http://localhost/core/error", {
          method: "POST",
          headers: request.headers,
          body: response.body,
        });
      }
    }

    const liveReloadScript = globalThis.${BINDING_DATA_LIVE_RELOAD_SCRIPT};
    if (
      liveReloadScript !== undefined &&
      response.headers.get("Content-Type")?.toLowerCase().includes("text/html")
    ) {
      const headers = new Headers(response.headers);
      const contentLength = parseInt(headers.get("content-length"));
      if (!isNaN(contentLength)) {
        headers.set("content-length", contentLength + liveReloadScript.byteLength);
      }
      
      const { readable, writable } = new IdentityTransformStream();
      event.waitUntil((async () => {
        await response.body?.pipeTo(writable, { preventClose: true });
        const writer = writable.getWriter();
        await writer.write(liveReloadScript);
        await writer.close();
      })());

      return new Response(readable, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return response;
  } catch (e) {
    // TODO: return pretty-error page here
    return new Response(e.stack);
  }
}
addEventListener("fetch", (event) => {
  event.respondWith(handleEvent(event));
});
`;
export const SCRIPT_CUSTOM_SERVICE = `addEventListener("fetch", (event) => {
  const request = new Request(event.request);
  request.headers.set("${HEADER_CUSTOM_SERVICE}", ${BINDING_TEXT_CUSTOM_SERVICE});
  request.headers.set("${HEADER_ORIGINAL_URL}", request.url);
  event.respondWith(${BINDING_SERVICE_LOOPBACK}.fetch(request));
})`;

const now = new Date();
const CURRENT_COMPATIBILITY_DATE = [
  now.getFullYear(),
  (now.getMonth() + 1).toString().padStart(2, "0"),
  now.getDate().toString().padStart(2, "0"),
].join("-");

const FALLBACK_COMPATIBILITY_DATE = "2000-01-01";

function validateCompatibilityDate(log: Log, compatibilityDate: string) {
  if (numericCompare(compatibilityDate, CURRENT_COMPATIBILITY_DATE) > 0) {
    // If this compatibility date is in the future, throw
    throw new MiniflareCoreError(
      "ERR_FUTURE_COMPATIBILITY_DATE",
      `Compatibility date "${compatibilityDate}" is in the future and unsupported`
    );
  } else if (
    numericCompare(compatibilityDate, supportedCompatibilityDate) > 0
  ) {
    // If this compatibility date is greater than the maximum supported
    // compatibility date of the runtime, but not in the future, warn,
    // and use the maximum supported date instead
    log.warn(
      [
        "The latest compatibility date supported by the installed Cloudflare Workers Runtime is ",
        bold(`"${supportedCompatibilityDate}"`),
        ",\nbut you've requested ",
        bold(`"${compatibilityDate}"`),
        ". Falling back to ",
        bold(`"${supportedCompatibilityDate}"`),
        "...",
      ].join("")
    );
    return supportedCompatibilityDate;
  }
  return compatibilityDate;
}

export const CORE_PLUGIN: Plugin<
  typeof CoreOptionsSchema,
  typeof CoreSharedOptionsSchema
> = {
  options: CoreOptionsSchema,
  sharedOptions: CoreSharedOptionsSchema,
  getBindings(options, workerIndex) {
    const bindings: Awaitable<Worker_Binding>[] = [];

    if (options.bindings !== undefined) {
      bindings.push(
        ...Object.entries(options.bindings).map(([name, value]) => ({
          name,
          json: JSON.stringify(value),
        }))
      );
    }
    if (options.wasmBindings !== undefined) {
      bindings.push(
        ...Object.entries(options.wasmBindings).map(([name, path]) =>
          fs.readFile(path).then((wasmModule) => ({ name, wasmModule }))
        )
      );
    }
    if (options.textBlobBindings !== undefined) {
      bindings.push(
        ...Object.entries(options.textBlobBindings).map(([name, path]) =>
          fs.readFile(path, "utf8").then((text) => ({ name, text }))
        )
      );
    }
    if (options.dataBlobBindings !== undefined) {
      bindings.push(
        ...Object.entries(options.dataBlobBindings).map(([name, path]) =>
          fs.readFile(path).then((data) => ({ name, data }))
        )
      );
    }
    if (options.serviceBindings !== undefined) {
      bindings.push(
        ...Object.entries(options.serviceBindings).map(([name, service]) => {
          let serviceName: string;
          if (typeof service === "function") {
            // Custom `fetch` function
            serviceName = getCustomServiceName(workerIndex, name);
          } else if (typeof service === "object") {
            // Builtin workerd service: network, external, disk
            serviceName = getBuiltinServiceName(workerIndex, name);
          } else {
            // Regular user worker
            serviceName = getUserServiceName(service);
          }
          return {
            name: name,
            service: { name: serviceName },
          };
        })
      );
    }

    return Promise.all(bindings);
  },
  async getServices({
    log,
    options,
    optionsVersion,
    workerBindings,
    workerIndex,
    sharedOptions,
    durableObjectClassNames,
    additionalModules,
    loopbackPort,
  }) {
    // Define core/shared services.
    const loopbackBinding: Worker_Binding = {
      name: BINDING_SERVICE_LOOPBACK,
      service: { name: SERVICE_LOOPBACK },
    };

    // Services get de-duped by name, so only the first worker's
    // SERVICE_LOOPBACK and SERVICE_ENTRY will be used
    const serviceEntryBindings: Worker_Binding[] = [
      loopbackBinding, // For converting stack-traces to pretty-error pages
      { name: BINDING_JSON_VERSION, json: optionsVersion.toString() },
      { name: BINDING_JSON_CF_BLOB, json: JSON.stringify(sharedOptions.cf) },
    ];
    if (sharedOptions.liveReload) {
      const liveReloadScript = LIVE_RELOAD_SCRIPT_TEMPLATE(loopbackPort);
      serviceEntryBindings.push({
        name: BINDING_DATA_LIVE_RELOAD_SCRIPT,
        data: encoder.encode(liveReloadScript),
      });
    }
    const services: Service[] = [
      {
        name: SERVICE_LOOPBACK,
        external: { http: { cfBlobHeader: HEADER_CF_BLOB } },
      },
      {
        name: SERVICE_ENTRY,
        worker: {
          serviceWorkerScript: SCRIPT_ENTRY,
          compatibilityDate: "2022-09-01",
          bindings: serviceEntryBindings,
        },
      },
      // Allow access to private/public addresses:
      // https://github.com/cloudflare/miniflare/issues/412
      {
        name: "internet",
        network: {
          // Can't use `["public", "private"]` here because of
          // https://github.com/cloudflare/workerd/issues/62
          allow: ["0.0.0.0/0"],
          deny: [],
          tlsOptions: { trustBrowserCas: true },
        },
      },
    ];

    // Define regular user worker if script is set
    const workerScript = getWorkerScript(options, workerIndex);
    if (workerScript !== undefined) {
      // Add additional modules (e.g. "__STATIC_CONTENT_MANIFEST") if any
      if ("modules" in workerScript) {
        workerScript.modules.push(...additionalModules);
      }

      const name = getUserServiceName(options.name);
      const classNames = durableObjectClassNames.get(name) ?? [];
      const compatibilityDate = validateCompatibilityDate(
        log,
        options.compatibilityDate ?? FALLBACK_COMPATIBILITY_DATE
      );

      services.push({
        name,
        worker: {
          ...workerScript,
          compatibilityDate,
          compatibilityFlags: options.compatibilityFlags,
          bindings: workerBindings,
          durableObjectNamespaces: classNames.map((className) => ({
            className,
            uniqueKey: className,
          })),
          durableObjectStorage: { inMemory: kVoid },
          cacheApiOutbound: { name: getCacheServiceName(workerIndex) },
        },
      });
      serviceEntryBindings.push({
        name: BINDING_SERVICE_USER,
        service: { name },
      });
    }

    // Define custom `fetch` services if set
    if (options.serviceBindings !== undefined) {
      for (const [name, service] of Object.entries(options.serviceBindings)) {
        if (typeof service === "function") {
          // Custom `fetch` function
          services.push({
            name: getCustomServiceName(workerIndex, name),
            worker: {
              serviceWorkerScript: SCRIPT_CUSTOM_SERVICE,
              compatibilityDate: "2022-09-01",
              bindings: [
                {
                  name: BINDING_TEXT_CUSTOM_SERVICE,
                  text: `${workerIndex}/${name}`,
                },
                loopbackBinding,
              ],
            },
          });
        } else if (typeof service === "object") {
          // Builtin workerd service: network, external, disk
          services.push({
            name: getBuiltinServiceName(workerIndex, name),
            ...service,
          });
        }
      }
    }

    return services;
  },
};

function getWorkerScript(
  options: z.infer<typeof CoreOptionsSchema>,
  workerIndex: number
): { serviceWorkerScript: string } | { modules: Worker_Module[] } | undefined {
  if (Array.isArray(options.modules)) {
    // If `modules` is a manually defined modules array, use that
    const modulesRoot = options.modulesRoot ?? "";
    return {
      modules: options.modules.map((module) =>
        convertModuleDefinition(modulesRoot, module)
      ),
    };
  }

  // Otherwise get code, preferring string `script` over `scriptPath`
  let code;
  if (options.script !== undefined) {
    code = options.script;
  } else if (options.scriptPath !== undefined) {
    code = readFileSync(options.scriptPath, "utf8");
  } else {
    // If neither `script`, `scriptPath` nor `modules` is defined, this worker
    // doesn't have any code
    return;
  }

  if (options.modules) {
    // If `modules` is `true`, automatically collect modules...
    const locator = new ModuleLocator(options.modulesRules);
    // If `script` and `scriptPath` are set, resolve modules in `script`
    // against `scriptPath`.
    locator.visitEntrypoint(
      code,
      options.scriptPath ?? buildStringScriptPath(workerIndex)
    );
    return { modules: locator.modules };
  } else {
    // ...otherwise, `modules` will either be `false` or `undefined`, so treat
    // `code` as a service worker
    return { serviceWorkerScript: code };
  }
}

export * from "./errors";
export * from "./modules";
export * from "./services";
