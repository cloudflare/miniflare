// noinspection ES6ConvertVarToLetConst

import assert from "assert";
import http from "http";
import https from "https";
import net from "net";
import { Transform, Writable } from "stream";
import { URL } from "url";
import zlib from "zlib";
import {
  CorePluginSignatures,
  IncomingRequestCfProperties,
  MiniflareCore,
  Request,
  Response,
  _getBodyLength,
  _headersFromIncomingRequest,
  fetch,
  logResponse,
} from "@miniflare/core";
import { Log, prefixError, randomHex } from "@miniflare/shared";
import { coupleWebSocket } from "@miniflare/web-sockets";
import { BodyInit, Headers } from "undici";
import { getAccessibleHosts } from "./helpers";
import { HTTPPlugin, RequestMeta } from "./plugin";

export * from "./helpers";
export * from "./plugin";

export const DEFAULT_PORT = 8787;

export type HTTPPluginSignatures = CorePluginSignatures & {
  HTTPPlugin: typeof HTTPPlugin;
};

const liveReloadScript = `<script defer type="application/javascript">
(function () {
  // Miniflare Live Reload
  var url = new URL("/cdn-cgi/mf/reload", location.origin);
  url.protocol = url.protocol.replace("http", "ws");
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
const liveReloadScriptLength = Buffer.byteLength(liveReloadScript);

export async function convertNodeRequest(
  req: http.IncomingMessage,
  meta?: RequestMeta
): Promise<{ request: Request; url: URL }> {
  // @ts-expect-error encrypted is only defined in tls.TLSSocket
  const protocol = req.socket.encrypted ? "https" : "http";
  const origin = `${protocol}://${req.headers.host ?? "localhost"}`;
  const url = new URL(req.url ?? "", origin);

  let body: BodyInit | null = null;
  // Previously, we performed an optimisation to convert this body to a "bytes"-
  // stream, so we didn't have to do this later on when accessing the body in
  // a Worker (request bodies must support BYOB reads). Since `undici@5.12.0`,
  // cloning a body now invokes `structuredClone` on the underlying stream
  // (https://github.com/nodejs/undici/pull/1697). Unfortunately, due to a bug
  // in Node, byte streams cannot be `structuredClone`d
  // (https://github.com/nodejs/undici/issues/1873,
  // https://github.com/nodejs/node/pull/45955), leading to issues when
  // attempting to clone incoming requests.
  if (req.method !== "GET" && req.method !== "HEAD") body = req;

  // Add additional Cloudflare specific headers:
  // https://support.cloudflare.com/hc/en-us/articles/200170986-How-does-Cloudflare-handle-HTTP-Request-headers-
  const proto = meta?.forwardedProto ?? "https";
  let ip = meta?.realIp ?? req.socket.remoteAddress ?? "";
  // Convert IPv6 loopback address to IPv4 address
  if (ip === "::1") ip = "127.0.0.1";
  // Remove IPv6 prefix for IPv4 addresses
  if (ip.startsWith("::ffff:")) ip = ip.substring("::ffff:".length);
  // We're a bit naughty here mutating the incoming request, but this ensures
  // the headers are included in the pretty-error page. If we used the new
  // converted Request instance's headers, we wouldn't have connection, keep-
  // alive, etc as we strip those. We need to take ownership of the request
  // anyway though, since we're consuming its body.
  req.headers["x-forwarded-proto"] ??= proto;
  req.headers["x-real-ip"] ??= ip;
  req.headers["cf-connecting-ip"] ??= ip;
  req.headers["cf-ipcountry"] ??= meta?.cf?.country ?? "US";
  req.headers["cf-ray"] ??= randomHex(16);
  req.headers["cf-visitor"] ??= `{"scheme":"${proto}"}`;
  req.headers["host"] = url.host;

  // Store original `Accept-Encoding` for `request.cf.clientAcceptEncoding`
  const clientAcceptEncoding = req.headers["accept-encoding"];
  // Only the `Set-Cookie` header is an array: https://nodejs.org/api/http.html#messageheaders
  assert(!Array.isArray(clientAcceptEncoding));
  // The Workers runtime will always set `Accept-Encoding` to `gzip`:
  // https://github.com/cloudflare/miniflare/issues/180
  req.headers["accept-encoding"] = "gzip";

  // Build Headers object from request
  const headers = _headersFromIncomingRequest(req);

  // Create Request with additional Cloudflare specific properties:
  // https://developers.cloudflare.com/workers/runtime-apis/request#incomingrequestcfproperties
  const request = new Request(url, {
    method: req.method,
    headers,
    body,
    cf: {
      ...meta?.cf,
      clientAcceptEncoding,
    } as IncomingRequestCfProperties,
    // Incoming requests always have their redirect mode set to manual:
    // https://developers.cloudflare.com/workers/runtime-apis/request#requestinit
    redirect: "manual",
    // Technically, we're constructing a Miniflare `Request` here, so we
    // shouldn't be passing `duplex`. However, we only automatically set
    // `duplex` when we pass a `ReadableStream` body, whereas in this case
    // we're passing a `http.IncomingMessage`. `undici` converts any
    // `AsyncIterable` to a stream, so this is fine.
    duplex: body === null ? undefined : "half",
  });
  return { request, url };
}

export type RequestListener = (
  req: http.IncomingMessage,
  res?: http.ServerResponse
) => Promise<Response | undefined>;

async function writeResponse(
  response: Response,
  res: http.ServerResponse,
  liveReload = false,
  log?: Log
) {
  const headers: http.OutgoingHttpHeaders = {};
  // eslint-disable-next-line prefer-const
  for (let [key, value] of response.headers) {
    key = key.toLowerCase();
    if (key === "set-cookie") {
      // Multiple Set-Cookie headers should be treated as separate headers
      // @ts-expect-error getAll is added to the Headers prototype by
      // importing @miniflare/core
      headers["set-cookie"] = response.headers.getAll("set-cookie");
    } else if (key !== "content-length") {
      // Content-Length has special handling below
      headers[key] = value;
    }
  }

  // Use body's actual length instead of the Content-Length header if set,
  // see https://github.com/cloudflare/miniflare/issues/148. We also might
  // need to adjust this later for live reloading so hold onto it.
  const contentLengthHeader = response.headers.get("Content-Length");
  const contentLength =
    _getBodyLength(response) ??
    (contentLengthHeader === null ? null : parseInt(contentLengthHeader));
  if (contentLength !== null && !isNaN(contentLength)) {
    headers["content-length"] = contentLength;
  }

  // If a Content-Encoding is set, and the user hasn't encoded the body,
  // we're responsible for doing so.
  const encoders: Transform[] = [];
  if (headers["content-encoding"] && response.encodeBody === "automatic") {
    // Reverse of https://github.com/nodejs/undici/blob/48d9578f431cbbd6e74f77455ba92184f57096cf/lib/fetch/index.js#L1660
    const codings = headers["content-encoding"]
      .toString()
      .toLowerCase()
      .split(",")
      .map((x) => x.trim());
    for (const coding of codings) {
      if (/(x-)?gzip/.test(coding)) {
        encoders.push(zlib.createGzip());
      } else if (/(x-)?deflate/.test(coding)) {
        encoders.push(zlib.createDeflate());
      } else if (coding === "br") {
        encoders.push(zlib.createBrotliCompress());
      } else {
        // Unknown encoding, don't do any encoding at all
        log?.warn(`Unknown encoding \"${coding}\", sending plain response...`);
        encoders.length = 0;
        break;
      }
    }
    if (encoders.length > 0) {
      // Content-Length will be wrong as it's for the decoded length
      delete headers["content-length"];
    }
  }

  // Add live reload script if enabled, this isn't an already encoded
  // response, and it's HTML
  const liveReloadEnabled =
    liveReload &&
    response.encodeBody === "automatic" &&
    response.headers.get("content-type")?.toLowerCase().includes("text/html");

  // If Content-Length is specified, and we're live-reloading, we'll
  // need to adjust it to make room for the live reload script
  if (liveReloadEnabled && contentLength !== null) {
    if (!isNaN(contentLength)) {
      // Append length of live reload script
      headers["content-length"] = contentLength + liveReloadScriptLength;
    }
  }

  res.writeHead(response.status, headers);

  // `initialStream` is the stream we'll write the response to. It
  // should end up as the first encoder, piping to the next encoder,
  // and finally piping to the response:
  //
  // encoders[0] (initialStream) -> encoders[1] -> res
  //
  // Not using `pipeline(passThrough, ...encoders, res)` here as that
  // gives a premature close error with server sent events. This also
  // avoids creating an extra stream even when we're not encoding.
  let initialStream: Writable = res;
  for (let i = encoders.length - 1; i >= 0; i--) {
    encoders[i].pipe(initialStream);
    initialStream = encoders[i];
  }

  // Response body may be null if empty
  if (response.body) {
    for await (const chunk of response.body) {
      if (chunk) initialStream.write(chunk);
    }

    if (liveReloadEnabled) {
      initialStream.write(liveReloadScript);
    }
  }

  initialStream.end();
}

export function createRequestListener<Plugins extends HTTPPluginSignatures>(
  mf: MiniflareCore<Plugins>
): RequestListener {
  return async (req, res) => {
    const { CorePlugin, HTTPPlugin } = await mf.getPlugins();
    const start = process.hrtime();
    const startCpu = CorePlugin.inaccurateCpu ? process.cpuUsage() : undefined;
    const { request, url } = await convertNodeRequest(
      req,
      await HTTPPlugin.getRequestMeta(req)
    );

    let response: Response | undefined;
    let waitUntil: Promise<unknown[]> | undefined;
    let status = 500;

    // Check if path matches /cdn-cgi/* ignoring trailing slash. These paths
    // can't be handled by workers and are used for utility interfaces.
    const pathname = url.pathname.replace(/\/$/, "");
    if (pathname.startsWith("/cdn-cgi/")) {
      // TODO (someday): consider adding other utility interfaces for KV, DO, etc
      //  (maybe add another Plugin field/method/decorator for contributes)
      if (pathname === "/cdn-cgi/mf/scheduled") {
        req.method = "SCHD";
        const time = url.searchParams.get("time");
        const cron = url.searchParams.get("cron");
        waitUntil = mf.dispatchScheduled(
          time ? parseInt(time) : undefined,
          cron ?? undefined,
          url
        );
        status = 200;
        res?.writeHead(status, { "Content-Type": "text/plain; charset=UTF-8" });
        res?.end();
      } else if (pathname.startsWith("/cdn-cgi/scripts/")) {
        response = await fetch(new URL(pathname, "https://cloudflare.com"));
        status = response.status;
        if (res) {
          await writeResponse(response, res, HTTPPlugin.liveReload, mf.log);
        }
      } else {
        status = 404;
        res?.writeHead(status, { "Content-Type": "text/plain; charset=UTF-8" });
        res?.end();
      }
    } else {
      try {
        response = await mf.dispatchFetch(request);
        waitUntil = response.waitUntil();
        status = response.status;
        if (res) {
          await writeResponse(response, res, HTTPPlugin.liveReload, mf.log);
        }
      } catch (e: any) {
        // MIME types aren't case sensitive
        const accept = req.headers.accept?.toLowerCase() ?? "";
        const userAgent = req.headers["user-agent"]?.toLowerCase() ?? "";
        if (
          !userAgent.includes("curl/") &&
          (accept.includes("text/html") ||
            accept.includes("*/*") ||
            accept.includes("text/*"))
        ) {
          // Send pretty HTML error page if client accepts it
          const Youch: typeof import("youch").default = require("youch");
          const youch = new Youch(e, req);
          youch.addLink(() => {
            const links = [
              '<a href="https://developers.cloudflare.com/workers/" target="_blank" style="text-decoration:none">📚 Workers Docs</a>',
              '<a href="https://discord.gg/cloudflaredev" target="_blank" style="text-decoration:none">💬 Workers Discord</a>',
              '<a href="https://miniflare.dev" target="_blank" style="text-decoration:none">🔥 Miniflare Docs</a>',
            ];
            // Live reload is basically a link right?
            if (HTTPPlugin.liveReload) links.push(liveReloadScript);
            return links.join("");
          });
          const errorHtml = await youch.toHTML();
          res?.writeHead(500, { "Content-Type": "text/html; charset=UTF-8" });
          res?.end(errorHtml, "utf8");
        } else {
          // Otherwise, send plaintext stack trace
          res?.writeHead(500, { "Content-Type": "text/plain; charset=UTF-8" });
          res?.end(e.stack, "utf8");
        }

        // Add method and URL to stack trace
        mf.log.error(prefixError(`${req.method} ${req.url}`, e));
      }
    }

    assert(req.method && req.url);
    const logPromise = logResponse(mf.log, {
      start,
      startCpu,
      method: req.method,
      url: req.url,
      status,
      waitUntil,
    });
    // `res` will be undefined if we're calling this function in response to a
    // WebSocket upgrade. In that case, we don't want to wait for `waitUntil`s
    // to resolve, before we can use the returned `response`. So, only `await`
    // if we've already written the `response` somewhere.
    if (res !== undefined) await logPromise;
    return response;
  };
}

const restrictedWebSocketUpgradeHeaders = [
  "upgrade",
  "connection",
  "sec-websocket-accept",
];

export async function createServer<Plugins extends HTTPPluginSignatures>(
  mf: MiniflareCore<Plugins>,
  options?: http.ServerOptions & https.ServerOptions
): Promise<http.Server | https.Server> {
  const plugins = await mf.getPlugins();
  const listener = createRequestListener(mf);

  // Setup HTTP server
  let server: http.Server | https.Server;
  if (plugins.HTTPPlugin.httpsEnabled) {
    const httpsOptions = plugins.HTTPPlugin.httpsOptions;
    assert(httpsOptions);
    server = https.createServer({ ...httpsOptions, ...options }, listener);
  } else {
    server = http.createServer(options ?? {}, listener);
  }

  const { WebSocketServer }: typeof import("ws") = require("ws");

  // Setup WebSocket servers
  const webSocketServer = new WebSocketServer({
    noServer: true,
    // Disable automatic handling of `Sec-WebSocket-Protocol` header, Cloudflare
    // Workers require users to include this header themselves in `Response`s:
    // https://github.com/cloudflare/miniflare/issues/179
    handleProtocols: () => false,
  });
  const liveReloadServer = new WebSocketServer({ noServer: true });

  // Add custom headers included in response to WebSocket upgrade requests
  const extraHeaders = new WeakMap<http.IncomingMessage, Headers>();
  webSocketServer.on("headers", (headers, req) => {
    const extra = extraHeaders.get(req);
    extraHeaders.delete(req);
    if (extra) {
      for (const [key, value] of extra) {
        if (!restrictedWebSocketUpgradeHeaders.includes(key.toLowerCase())) {
          headers.push(`${key}: ${value}`);
        }
      }
    }
  });

  server.on("upgrade", async (request, socket, head) => {
    // Only interested in pathname so base URL doesn't matter
    const { pathname } = new URL(request.url ?? "", "http://localhost");
    if (pathname === "/cdn-cgi/mf/reload") {
      // If this is the for live-reload, handle the request ourselves
      liveReloadServer.handleUpgrade(request, socket as any, head, (ws) => {
        liveReloadServer.emit("connection", ws, request);
      });
    } else {
      // Otherwise, handle the request in the worker
      const response = await listener(request);

      // Check web socket response was returned
      const webSocket = response?.webSocket;
      if (response?.status === 101 && webSocket) {
        // Accept and couple the Web Socket
        extraHeaders.set(request, response.headers);
        webSocketServer.handleUpgrade(request, socket as any, head, (ws) => {
          void coupleWebSocket(ws, webSocket);
          webSocketServer.emit("connection", ws, request);
        });
        return;
      }

      // Otherwise, we'll be returning a regular HTTP response
      const res = new http.ServerResponse(request);
      // `socket` is guaranteed to be an instance of `net.Socket`:
      // https://nodejs.org/api/http.html#event-upgrade_1
      assert(socket instanceof net.Socket);
      res.assignSocket(socket);

      // If no response was provided, or it was an "ok" response, log an error
      if (!response || (200 <= response.status && response.status < 300)) {
        res.writeHead(500);
        res.end();
        mf.log.error(
          new TypeError(
            "Web Socket request did not return status 101 Switching Protocols response with Web Socket"
          )
        );
        return;
      }

      // Otherwise, send the response as is (e.g. unauthorised),
      // always disabling live-reload as this is a WebSocket upgrade
      await writeResponse(response, res, false /* liveReload */, mf.log);
    }
  });
  const reloadListener = () => {
    // Reload all connected live reload clients
    for (const ws of liveReloadServer.clients) {
      ws.close(1012, "Service Restart");
    }
    // Close all existing web sockets on reload
    for (const ws of webSocketServer.clients) {
      ws.close(1012, "Service Restart");
    }
  };
  mf.addEventListener("reload", reloadListener);
  server.on("close", () => mf.removeEventListener("reload", reloadListener));

  return server;
}

export async function startServer<Plugins extends HTTPPluginSignatures>(
  mf: MiniflareCore<Plugins>,
  options?: http.ServerOptions & https.ServerOptions
): Promise<http.Server | https.Server> {
  const server = await createServer(mf, options);
  const plugins = await mf.getPlugins();
  const { httpsEnabled, host, port = DEFAULT_PORT } = plugins.HTTPPlugin;
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const log = mf.log;
      const protocol = httpsEnabled ? "https" : "http";
      const accessibleHosts =
        host && host !== "0.0.0.0" ? [host] : getAccessibleHosts(true);
      const address = server.address();
      const usedPort =
        address && typeof address === "object" ? address.port : port;
      log.info(`Listening on ${host ?? ""}:${usedPort}`);
      for (const accessibleHost of accessibleHosts) {
        log.info(`- ${protocol}://${accessibleHost}:${usedPort}`);
      }
      resolve(server);
    });
  });
}
