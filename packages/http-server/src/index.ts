import assert from "assert";
import http, { OutgoingHttpHeaders } from "http";
import https from "https";
import { arrayBuffer } from "stream/consumers";
import { URL } from "url";
import {
  CorePluginSignatures,
  MiniflareCore,
  Request,
  Response,
  logResponse,
} from "@miniflare/core";
import { randomHex } from "@miniflare/shared";
import { coupleWebSocket } from "@miniflare/web-sockets";
import { BodyInit, Headers } from "undici";
// @ts-expect-error ws's type definitions haven't been updated yet
import StandardWebSocket, { WebSocketServer } from "ws";
import { getAccessibleHosts } from "./helpers";
import { HTTPPlugin, RequestMeta } from "./plugin";

export * from "./helpers";
export * from "./plugin";

export type HTTPPluginSignatures = CorePluginSignatures & {
  HTTPPlugin: typeof HTTPPlugin;
};

export async function convertNodeRequest(
  req: http.IncomingMessage,
  upstream?: string,
  meta?: RequestMeta
): Promise<{ request: Request; url: URL }> {
  // noinspection HttpUrlsUsage
  const url = new URL(req.url ?? "", upstream ?? `http://${req.headers.host}`);

  let body: BodyInit | null = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    // If the Transfer-Encoding is not chunked, buffer the request. If we
    // didn't do this and tried to make a fetch with this body in the worker,
    // it would be sent with chunked Transfer-Encoding, since req is a stream.
    if (req.headers["transfer-encoding"]?.includes("chunked")) {
      body = req;
    } else if (req.headers["content-length"] !== "0") {
      body = await arrayBuffer(req);
    }
  }

  // Build Headers object from request
  const headers = new Headers();
  for (const [name, values] of Object.entries(req.headers)) {
    // These headers are unsupported in undici fetch requests, they're added
    // automatically
    if (
      name === "transfer-encoding" ||
      name === "connection" ||
      name === "keep-alive" ||
      name === "expect"
    ) {
      continue;
    }
    if (Array.isArray(values)) {
      for (const value of values) headers.append(name, value);
    } else if (values !== undefined) {
      headers.append(name, values);
    }
  }

  // Add additional Cloudflare specific headers:
  // https://support.cloudflare.com/hc/en-us/articles/200170986-How-does-Cloudflare-handle-HTTP-Request-headers-
  const proto = meta?.forwardedProto ?? "https";
  let ip = meta?.realIp ?? req.socket.remoteAddress ?? "";
  // Remove IPv6 prefix for IPv4 addresses
  if (ip.startsWith("::ffff:")) ip = ip.substring("::ffff:".length);
  headers.set("x-forwarded-proto", proto);
  headers.set("x-real-ip", ip);
  headers.set("cf-connecting-ip", ip);
  headers.set("cf-ipcountry", meta?.cf?.country ?? "US");
  headers.set("cf-ray", randomHex(16));
  headers.set("cf-visitor", `{"scheme":"${proto}"}`);

  // Create Request with additional Cloudflare specific properties:
  // https://developers.cloudflare.com/workers/runtime-apis/request#incomingrequestcfproperties
  const request = new Request(url, {
    method: req.method,
    headers,
    body,
    cf: meta?.cf,
  });
  return { request, url };
}

export type RequestListener = (
  req: http.IncomingMessage,
  res?: http.ServerResponse
) => Promise<Response | undefined>;

export function createRequestListener<Plugins extends HTTPPluginSignatures>(
  mf: MiniflareCore<Plugins>
): RequestListener {
  return async (req, res) => {
    const { CorePlugin, HTTPPlugin } = await mf.getPlugins();
    const start = process.hrtime();
    const { request, url } = await convertNodeRequest(
      req,
      CorePlugin.upstream,
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
          cron ?? undefined
        );
        status = 200;
      } else {
        status = 404;
      }
      res?.writeHead(status, { "Content-Type": "text/plain; charset=UTF-8" });
      res?.end();
    } else {
      try {
        response = await mf.dispatchFetch(request);
        waitUntil = response.waitUntil();
        status = response.status;
        const headers: OutgoingHttpHeaders = {};
        for (const [key, value] of response.headers) {
          if (key.length === 10 && key.toLowerCase() === "set-cookie") {
            // Multiple Set-Cookie headers should be treated as separate headers
            headers["set-cookie"] = response.headers.getAll("set-cookie");
          } else {
            headers[key] = value;
          }
        }
        res?.writeHead(response.status, headers);
        // Response body may be null if empty
        if (response.body) {
          for await (const chunk of response.body) {
            if (chunk) res?.write(chunk);
          }
        }
        res?.end();
      } catch (e: any) {
        // MIME types aren't case sensitive
        const accept = req.headers.accept?.toLowerCase() ?? "";
        if (
          accept.includes("text/html") ||
          accept.includes("*/*") ||
          accept.includes("text/*")
        ) {
          // Send pretty HTML error page if client accepts it
          const { default: Youch } = await import("youch");
          const youch = new Youch(e, req);
          youch.addLink(() => {
            return [
              '<a href="https://developers.cloudflare.com/workers/" target="_blank" style="text-decoration:none">📚 Workers Docs</a>',
              '<a href="https://discord.gg/cloudflaredev" target="_blank" style="text-decoration:none">💬 Workers Discord</a>',
              '<a href="https://miniflare.dev" target="_blank" style="text-decoration:none">🔥 Miniflare Docs</a>',
            ].join("");
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
        const proxiedError = new Proxy(e, {
          get(target, propertyKey, receiver) {
            const value = Reflect.get(target, propertyKey, receiver);
            return propertyKey === "stack"
              ? `${req.method} ${req.url}: ${value}`
              : value;
          },
        });
        mf.log.error(proxiedError);
      }
    }

    assert(req.method && req.url);
    await logResponse(mf.log, {
      start,
      method: req.method,
      url: req.url,
      status,
      waitUntil,
    });
    return response;
  };
}

export type WebSocketUpgradeListener = (
  ws: StandardWebSocket,
  req: http.IncomingMessage
) => void;

export function createWebSocketUpgradeListener<
  Plugins extends CorePluginSignatures
>(
  mf: MiniflareCore<Plugins>,
  listener: RequestListener
): WebSocketUpgradeListener {
  return async (ws, req) => {
    // Handle request in worker
    const response = await listener(req);

    // Check web socket response was returned
    const webSocket = response?.webSocket;
    if (response?.status !== 101 || !webSocket) {
      ws.close(1002, "Protocol Error");
      mf.log.error(
        new TypeError(
          "Web Socket request did not return status 101 Switching Protocols response with Web Socket"
        )
      );
      return;
    }

    // Couple the web socket here
    await coupleWebSocket(ws, webSocket);
  };
}

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

  // Setup WebSocket server
  const upgrader = createWebSocketUpgradeListener(mf, listener);
  const webSocketServer = new WebSocketServer({ server });
  webSocketServer.on("connection", upgrader);
  const reloadListener = () => {
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
  const { httpsEnabled, host, port = 8787 } = plugins.HTTPPlugin;
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const log = mf.log;
      const protocol = httpsEnabled ? "https" : "http";
      const accessibleHosts = host ? [host] : getAccessibleHosts(true);
      log.info(`Listening on ${host ?? ""}:${port}`);
      for (const accessibleHost of accessibleHosts) {
        log.info(`- ${protocol}://${accessibleHost}:${port}`);
      }
      resolve(server);
    });
  });
}
