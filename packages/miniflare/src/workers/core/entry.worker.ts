import {
  Colorize,
  blue,
  bold,
  green,
  grey,
  red,
  reset,
  yellow,
} from "kleur/colors";
import { LogLevel, SharedHeaders } from "miniflare:shared";
import { CoreBindings, CoreHeaders } from "./constants";
import { STATUS_CODES } from "./http";
import { WorkerRoute, matchRoutes } from "./routing";

type Env = {
  [CoreBindings.SERVICE_LOOPBACK]: Fetcher;
  [CoreBindings.SERVICE_USER_FALLBACK]: Fetcher;
  [CoreBindings.TEXT_CUSTOM_SERVICE]: string;
  [CoreBindings.TEXT_UPSTREAM_URL]?: string;
  [CoreBindings.JSON_CF_BLOB]: IncomingRequestCfProperties;
  [CoreBindings.JSON_ROUTES]: WorkerRoute[];
  [CoreBindings.JSON_LOG_LEVEL]: LogLevel;
  [CoreBindings.DATA_LIVE_RELOAD_SCRIPT]: ArrayBuffer;
  [CoreBindings.DURABLE_OBJECT_NAMESPACE_PROXY]: DurableObjectNamespace;
} & {
  [K in `${typeof CoreBindings.SERVICE_USER_ROUTE_PREFIX}${string}`]:
    | Fetcher
    | undefined; // Won't have a `Fetcher` for every possible `string`
};

function getUserRequest(
  request: Request<unknown, IncomingRequestCfProperties>,
  env: Env
) {
  const originalUrl = request.headers.get(CoreHeaders.ORIGINAL_URL);
  const upstreamUrl = env[CoreBindings.TEXT_UPSTREAM_URL];
  let url = new URL(originalUrl ?? request.url);
  if (upstreamUrl !== undefined) {
    // If a custom `upstream` was specified, make sure the URL starts with it
    let path = url.pathname + url.search;
    // Remove leading slash, so we resolve relative to `upstream`'s path
    if (path.startsWith("/")) path = path.substring(1);
    url = new URL(path, upstreamUrl);
  }

  // Note when constructing new `Request`s from `request`, we must always pass
  // `request` as is to the `new Request()` constructor. Whilst prohibited by
  // the `Request` API spec, `GET` requests are allowed to have bodies. If
  // `Content-Length` or `Transfer-Encoding` are specified, `workerd` will give
  // the request a (potentially empty) body. Passing a bodied-GET-request
  // through to the `new Request()` constructor should throw, but `workerd` has
  // special handling to allow this if a `Request` instance is passed.
  // See https://github.com/cloudflare/workerd/issues/1122 for more details.
  request = new Request(url, request);
  if (request.cf === undefined) {
    request = new Request(request, { cf: env[CoreBindings.JSON_CF_BLOB] });
  }
  request.headers.delete(CoreHeaders.ORIGINAL_URL);
  request.headers.delete(CoreHeaders.DISABLE_PRETTY_ERROR);
  return request;
}

function getTargetService(request: Request, url: URL, env: Env) {
  let service: Fetcher | undefined = env[CoreBindings.SERVICE_USER_FALLBACK];

  const override = request.headers.get(CoreHeaders.ROUTE_OVERRIDE);
  request.headers.delete(CoreHeaders.ROUTE_OVERRIDE);

  const route = override ?? matchRoutes(env[CoreBindings.JSON_ROUTES], url);
  if (route !== null) {
    service = env[`${CoreBindings.SERVICE_USER_ROUTE_PREFIX}${route}`];
  }
  return service;
}

function maybePrettifyError(request: Request, response: Response, env: Env) {
  if (
    response.status !== 500 ||
    response.headers.get(CoreHeaders.ERROR_STACK) === null
  ) {
    return response;
  }

  // Forward `Accept` and `User-Agent` headers if defined
  const accept = request.headers.get("Accept");
  const userAgent = request.headers.get("User-Agent");
  const headers = new Headers();
  if (accept !== null) headers.set("Accept", accept);
  if (userAgent !== null) headers.set("User-Agent", userAgent);

  return env[CoreBindings.SERVICE_LOOPBACK].fetch(
    "http://localhost/core/error",
    {
      method: "POST",
      headers,
      body: response.body,
    }
  );
}

function maybeInjectLiveReload(
  response: Response,
  env: Env,
  ctx: ExecutionContext
) {
  const liveReloadScript = env[CoreBindings.DATA_LIVE_RELOAD_SCRIPT];
  if (
    liveReloadScript === undefined ||
    !response.headers.get("Content-Type")?.toLowerCase().includes("text/html")
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  // Safety of `!`: `parseInt(null)` is `NaN`
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const contentLength = parseInt(headers.get("content-length")!);
  if (!isNaN(contentLength)) {
    headers.set(
      "content-length",
      String(contentLength + liveReloadScript.byteLength)
    );
  }

  const { readable, writable } = new IdentityTransformStream();
  ctx.waitUntil(
    (async () => {
      await response.body?.pipeTo(writable, { preventClose: true });
      const writer = writable.getWriter();
      await writer.write(liveReloadScript);
      await writer.close();
    })()
  );

  return new Response(readable, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function colourFromHTTPStatus(status: number): Colorize {
  if (200 <= status && status < 300) return green;
  if (400 <= status && status < 500) return yellow;
  if (500 <= status) return red;
  return blue;
}

function maybeLogRequest(
  req: Request,
  res: Response,
  env: Env,
  ctx: ExecutionContext,
  startTime: number
) {
  if (env[CoreBindings.JSON_LOG_LEVEL] < LogLevel.INFO) return;

  const url = new URL(req.url);
  const statusText = (res.statusText.trim() || STATUS_CODES[res.status]) ?? "";
  const lines = [
    `${bold(req.method)} ${url.pathname} `,
    colourFromHTTPStatus(res.status)(`${bold(res.status)} ${statusText} `),
    grey(`(${Date.now() - startTime}ms)`),
  ];
  const message = reset(lines.join(""));

  ctx.waitUntil(
    env[CoreBindings.SERVICE_LOOPBACK].fetch("http://localhost/core/log", {
      method: "POST",
      headers: { [SharedHeaders.LOG_LEVEL]: LogLevel.INFO.toString() },
      body: message,
    })
  );
}

function handleProxy(request: Request, env: Env) {
  const ns = env[CoreBindings.DURABLE_OBJECT_NAMESPACE_PROXY];
  // Always use the same singleton Durable Object instance, so we always have
  // access to the same "heap"
  const id = ns.idFromName("");
  const stub = ns.get(id);
  return stub.fetch(request);
}

async function handleScheduled(
  params: URLSearchParams,
  service: Fetcher
): Promise<Response> {
  const time = params.get("time");
  const scheduledTime = time ? new Date(parseInt(time)) : undefined;
  const cron = params.get("cron") ?? undefined;

  const result = await service.scheduled({
    scheduledTime,
    cron,
  });

  return new Response(result.outcome, {
    status: result.outcome === "ok" ? 200 : 500,
  });
}

export default <ExportedHandler<Env>>{
  async fetch(request, env, ctx) {
    const startTime = Date.now();

    // The proxy client will always specify an operation
    const isProxy = request.headers.get(CoreHeaders.OP) !== null;
    if (isProxy) return handleProxy(request, env);

    // `dispatchFetch()` will always inject this header. When
    // calling this function, we never want to display the pretty-error page.
    // Instead, we propagate the error and reject the returned `Promise`.
    const disablePrettyErrorPage =
      request.headers.get(CoreHeaders.DISABLE_PRETTY_ERROR) !== null;

    request = getUserRequest(request, env);
    const url = new URL(request.url);
    const service = getTargetService(request, url, env);
    if (service === undefined) {
      return new Response("No entrypoint worker found", { status: 404 });
    }

    try {
      if (url.pathname === "/cdn-cgi/mf/scheduled") {
        return await handleScheduled(url.searchParams, service);
      }

      let response = await service.fetch(request);
      if (!disablePrettyErrorPage) {
        response = await maybePrettifyError(request, response, env);
      }
      response = maybeInjectLiveReload(response, env, ctx);
      maybeLogRequest(request, response, env, ctx, startTime);
      return response;
    } catch (e: any) {
      return new Response(e?.stack ?? String(e), { status: 500 });
    }
  },
};

export { ProxyServer } from "./proxy.worker";
