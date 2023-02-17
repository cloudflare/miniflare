import assert from "assert";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { HTTPPlugin } from "@miniflare/http-server";
import { QueueBroker } from "@miniflare/queues";
import {
  Clock,
  Compatibility,
  LogLevel,
  NoOpLog,
  PluginContext,
  QueueEventDispatcher,
} from "@miniflare/shared";
import {
  TestLog,
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
  unusable,
  useServer,
  useTmp,
} from "@miniflare/shared-test";
import test from "ava";

const log = new NoOpLog();
const compat = new Compatibility();
const rootPath = process.cwd();
const queueBroker = new QueueBroker();
const queueEventDispatcher: QueueEventDispatcher = async (_batch) => {};
const ctx: PluginContext = {
  log,
  compat,
  rootPath,
  queueBroker,
  queueEventDispatcher,
  sharedCache: unusable(),
};

test("HTTPPlugin: parses options from argv", (t) => {
  let options = parsePluginArgv(HTTPPlugin, [
    "--host",
    "127.0.0.1",
    "--port",
    "3000",
    "--open",
    "--https",
    "--https-key",
    "key.pem",
    "--https-cert",
    "cert.pem",
    "--https-ca",
    "ca.pem",
    "--https-pfx",
    "cert.pfx",
    "--https-passphrase",
    "the passphrase is passphrase",
    "--no-cf-fetch",
    "--live-reload",
  ]);
  t.deepEqual(options, {
    host: "127.0.0.1",
    port: 3000,
    open: true,
    https: true,
    httpsKeyPath: "key.pem",
    httpsCertPath: "cert.pem",
    httpsCaPath: "ca.pem",
    httpsPfxPath: "cert.pfx",
    httpsPassphrase: "the passphrase is passphrase",
    cfFetch: false,
    liveReload: true,
  });
  options = parsePluginArgv(HTTPPlugin, [
    "-H",
    "127.0.0.1",
    "-p",
    "3000",
    "-O",
    "https://localhost:8787",
    "--https",
    "./cert",
    "--cf-fetch",
    "./cf.json",
  ]);
  t.deepEqual(options, {
    host: "127.0.0.1",
    port: 3000,
    open: "https://localhost:8787",
    https: "./cert",
    cfFetch: "./cf.json",
  });
});
test("HTTPPlugin: parses options from wrangler config", (t) => {
  let options = parsePluginWranglerConfig(HTTPPlugin, {
    miniflare: {
      host: "127.0.0.1",
      port: 3000,
      open: true,
      https: true,
      cf_fetch: false,
      live_reload: true,
    },
  });
  t.like(options, {
    host: "127.0.0.1",
    port: 3000,
    open: true,
    https: true,
    cfFetch: false,
    liveReload: true,
  });
  options = parsePluginWranglerConfig(HTTPPlugin, {
    miniflare: { https: "./cert" },
  });
  t.like(options, {
    https: "./cert",
  });
  options = parsePluginWranglerConfig(HTTPPlugin, {
    miniflare: {
      https: {
        key: "key.pem",
        cert: "cert.pem",
        ca: "ca.pem",
        pfx: "cert.pfx",
        passphrase: "the passphrase is passphrase",
      },
    },
  });
  t.like(options, {
    httpsKeyPath: "key.pem",
    httpsCertPath: "cert.pem",
    httpsCaPath: "ca.pem",
    httpsPfxPath: "cert.pfx",
    httpsPassphrase: "the passphrase is passphrase",
  });
});
test("HTTPPlugin: logs options", (t) => {
  let logs = logPluginOptions(HTTPPlugin, {
    host: "127.0.0.1",
    port: 3000,
    open: true,
    https: true,
    httpsKey: "key",
    httpsKeyPath: "key.pem",
    httpsCert: "cert",
    httpsCertPath: "cert.pem",
    httpsCa: "ca",
    httpsCaPath: "ca.pem",
    httpsPfx: "pfx",
    httpsPfxPath: "cert.pfx",
    httpsPassphrase: "the passphrase is passphrase",
    cfFetch: "./cf.json",
    metaProvider: () => ({} as any),
    liveReload: true,
  });
  t.deepEqual(logs, [
    "Host: 127.0.0.1",
    "Port: 3000",
    "Open: true",
    "HTTPS: true",
    "HTTPS Key: key.pem",
    "HTTPS Cert: cert.pem",
    "HTTPS CA: ca.pem",
    "HTTPS PFX: cert.pfx",
    "HTTPS Passphrase: **********",
    "Request cf Object Fetch: cf.json",
    "Live Reload: true",
  ]);
  logs = logPluginOptions(HTTPPlugin, { cfFetch: true });
  t.deepEqual(logs, [
    `Request cf Object Fetch: node_modules${path.sep}.mf${path.sep}cf.json`,
  ]);
  logs = logPluginOptions(HTTPPlugin, { cfFetch: false });
  t.deepEqual(logs, []);
});

test("HTTPPlugin: httpsEnabled: true iff any https option set", (t) => {
  t.false(new HTTPPlugin(ctx).httpsEnabled);
  t.true(new HTTPPlugin(ctx, { https: true }).httpsEnabled);
  t.true(new HTTPPlugin(ctx, { https: "./cert" }).httpsEnabled);
  t.true(new HTTPPlugin(ctx, { httpsKey: "key" }).httpsEnabled);
  t.true(new HTTPPlugin(ctx, { httpsKeyPath: "key.pem" }).httpsEnabled);
  t.true(new HTTPPlugin(ctx, { httpsCert: "cert" }).httpsEnabled);
  t.true(new HTTPPlugin(ctx, { httpsCertPath: "cert.pem" }).httpsEnabled);
  t.true(new HTTPPlugin(ctx, { httpsCa: "ca" }).httpsEnabled);
  t.true(new HTTPPlugin(ctx, { httpsCaPath: "ca.pem" }).httpsEnabled);
  t.true(new HTTPPlugin(ctx, { httpsPfx: "pfx" }).httpsEnabled);
  t.true(new HTTPPlugin(ctx, { httpsPfxPath: "cert.pfx" }).httpsEnabled);
});

test("HTTPPlugin: getRequestMeta: uses cfProvider if defined", async (t) => {
  const plugin = new HTTPPlugin(ctx, {
    metaProvider: async (req) => ({
      forwardedProto: "http",
      realIp: "127.0.0.1",
      cf: { httpProtocol: `HTTP/${req.httpVersion}` } as any,
    }),
  });
  const cf = await plugin.getRequestMeta({ httpVersion: "1.1" } as any);
  t.is(cf.forwardedProto, "http");
  t.is(cf.realIp, "127.0.0.1");
  t.is(cf.cf?.httpProtocol, "HTTP/1.1");
});
test("HTTPPlugin: getRequestMeta: defaults to placeholder value", async (t) => {
  const plugin = new HTTPPlugin(ctx);
  const { cf } = await plugin.getRequestMeta({} as any);
  t.like(cf, { colo: "DFW", country: "US", httpProtocol: "HTTP/1.1" });
});

test("HTTPPlugin: setupCf: cf fetch disabled if explicitly disabled or cfProvider defined", async (t) => {
  const { http: upstream } = await useServer(t, (req, res) => {
    t.fail();
    res.end();
  });

  // Explicitly disable
  let plugin = new HTTPPlugin(
    ctx,
    { cfFetch: false },
    { cfFetch: true, cfFetchEndpoint: upstream }
  );
  await plugin.setupCf();
  // Define cfProvider
  plugin = new HTTPPlugin(
    ctx,
    { metaProvider: () => ({} as any) },
    { cfFetch: true, cfFetchEndpoint: upstream }
  );
  await plugin.setupCf();
  t.pass();
});
test("HTTPPlugin: setupCf: cf fetch caches cf.json at default location", async (t) => {
  const tmp = await useTmp(t);
  const cfPath = path.join(tmp, "cf.json");
  const { http: upstream } = await useServer(t, (req, res) =>
    res.end('{"colo": "LHR"}')
  );
  const log = new TestLog();
  const plugin = new HTTPPlugin(
    { ...ctx, log },
    {},
    { cfPath, cfFetch: true, cfFetchEndpoint: upstream }
  );
  await plugin.setupCf();
  t.deepEqual(await plugin.getRequestMeta({} as any), {
    cf: { colo: "LHR" } as any,
  });
  const cf = await fs.readFile(cfPath, "utf8");
  t.is(cf, '{"colo": "LHR"}');
  t.is(log.logsAtLevel(LogLevel.INFO)[0], "Updated `Request.cf` object cache!");
});
test("HTTPPlugin: setupCf: cf fetch caches cf.json at custom location", async (t) => {
  const tmp = await useTmp(t);
  const defaultCfPath = path.join(tmp, "cf.default.json");
  const customCfPath = path.join(tmp, "cf.custom.json");
  const { http: upstream } = await useServer(t, (req, res) =>
    res.end('{"colo": "LHR"}')
  );
  const log = new TestLog();
  const plugin = new HTTPPlugin(
    { ...ctx, log },
    { cfFetch: customCfPath },
    { cfPath: defaultCfPath, cfFetch: true, cfFetchEndpoint: upstream }
  );
  await plugin.setupCf();
  t.deepEqual(await plugin.getRequestMeta({} as any), {
    cf: { colo: "LHR" } as any,
  });
  t.false(existsSync(defaultCfPath));
  const cf = await fs.readFile(customCfPath, "utf8");
  t.is(cf, '{"colo": "LHR"}');
  t.is(log.logsAtLevel(LogLevel.INFO)[0], "Updated `Request.cf` object cache!");
});
test("HTTPPlugin: setupCf: cf fetch reuses cf.json", async (t) => {
  const tmp = await useTmp(t);
  const cfPath = path.join(tmp, "cf.json");
  await fs.writeFile(cfPath, '{"colo": "LHR"}', "utf8");
  const { http: upstream } = await useServer(t, (req, res) => {
    t.fail();
    res.end();
  });
  const log = new TestLog();
  const plugin = new HTTPPlugin(
    ctx,
    {},
    { cfPath, cfFetch: true, cfFetchEndpoint: upstream }
  );
  await plugin.setupCf();
  t.deepEqual(await plugin.getRequestMeta({} as any), {
    cf: { colo: "LHR" } as any,
  });
  t.is(log.logsAtLevel(LogLevel.INFO).length, 0);
});
test("HTTPPlugin: setupCf: cf fetch refetches cf.json if stale", async (t) => {
  const tmp = await useTmp(t);
  const cfPath = path.join(tmp, "cf.json");
  await fs.writeFile(cfPath, '{"colo": "LHR"}', "utf8");
  const clock: Clock = () => Date.now() + 86400000 * 30; // now + 30 days
  const { http: upstream } = await useServer(t, (req, res) =>
    res.end('{"colo": "MAN"}')
  );
  const log = new TestLog();
  const plugin = new HTTPPlugin(
    { ...ctx, log },
    {},
    { cfPath, cfFetch: true, cfFetchEndpoint: upstream, clock }
  );
  await plugin.setupCf();
  t.deepEqual(await plugin.getRequestMeta({} as any), {
    cf: { colo: "MAN" } as any,
  });
  const cf = await fs.readFile(cfPath, "utf8");
  t.is(cf, '{"colo": "MAN"}');
  t.is(log.logsAtLevel(LogLevel.INFO)[0], "Updated `Request.cf` object cache!");
});

test("HTTPPlugin: setupHttps: httpsOptions undefined if https disabled", async (t) => {
  const plugin = new HTTPPlugin(ctx);
  await plugin.setupHttps();
  t.is(plugin.httpsOptions, undefined);
});
test("HTTPPlugin: setupHttps: prefers raw strings over paths", async (t) => {
  const tmp = await useTmp(t);
  const nonExistentPath = path.join(tmp, "bad.txt");
  const plugin = new HTTPPlugin(ctx, {
    httpsKey: "test_key",
    httpsKeyPath: nonExistentPath,
    httpsCert: "test_cert",
    httpsCertPath: nonExistentPath,
    httpsCa: "test_ca",
    httpsCaPath: nonExistentPath,
    httpsPfx: "test_pfx",
    httpsPfxPath: nonExistentPath,
    httpsPassphrase: "test_passphrase",
  });
  await plugin.setupHttps();
  t.deepEqual(plugin.httpsOptions, {
    key: "test_key",
    cert: "test_cert",
    ca: "test_ca",
    pfx: "test_pfx",
    passphrase: "test_passphrase",
  });
});
test("HTTPPlugin: setupHttps: reads all option file paths", async (t) => {
  const tmp = await useTmp(t);
  const httpsKeyPath = path.join(tmp, "key");
  const httpsCertPath = path.join(tmp, "cert");
  const httpsCaPath = path.join(tmp, "ca");
  const httpsPfxPath = path.join(tmp, "pfx");
  await fs.writeFile(httpsKeyPath, "test_key", "utf8");
  await fs.writeFile(httpsCertPath, "test_cert", "utf8");
  await fs.writeFile(httpsCaPath, "test_ca", "utf8");
  await fs.writeFile(httpsPfxPath, "test_pfx", "utf8");
  const plugin = new HTTPPlugin(ctx, {
    httpsKeyPath,
    httpsCertPath,
    httpsCaPath,
    httpsPfxPath,
  });
  await plugin.setupHttps();
  t.deepEqual(plugin.httpsOptions, {
    key: "test_key",
    cert: "test_cert",
    ca: "test_ca",
    pfx: "test_pfx",
    passphrase: undefined,
  });
});
test("HTTPPlugin: setupHttps: throws errors if cannot load option files path", async (t) => {
  const tmp = await useTmp(t);
  const httpsKeyPath = path.join(tmp, "key");
  const httpsCertPath = path.join(tmp, "cert");
  const httpsCaPath = path.join(tmp, "ca");
  const httpsPfxPath = path.join(tmp, "pfx");
  const plugin = new HTTPPlugin(ctx, {
    httpsKeyPath,
    httpsCertPath,
    httpsCaPath,
    httpsPfxPath,
  });
  await t.throwsAsync(plugin.setupHttps(), { message: /ENOENT:.*key/ });
  await fs.writeFile(httpsKeyPath, "test_key", "utf8");
  await t.throwsAsync(plugin.setupHttps(), { message: /ENOENT:.*cert/ });
  await fs.writeFile(httpsCertPath, "test_cert", "utf8");
  await t.throwsAsync(plugin.setupHttps(), { message: /ENOENT:.*ca/ });
  await fs.writeFile(httpsCaPath, "test_ca", "utf8");
  await t.throwsAsync(plugin.setupHttps(), { message: /ENOENT:.*pfx/ });
  await fs.writeFile(httpsPfxPath, "test_pfx", "utf8");
  await plugin.setupHttps();
});
test("HTTPPlugin: setupHttps: generates self-signed certificate at default location", async (t) => {
  const log = new TestLog();
  const tmp = await useTmp(t);
  const plugin = new HTTPPlugin(
    { ...ctx, log },
    { https: true },
    { certRoot: tmp }
  );
  await plugin.setupHttps();
  t.deepEqual(log.logsAtLevel(LogLevel.INFO), [
    "Generating new self-signed certificate...",
  ]);
  const https = plugin.httpsOptions;
  t.not(https, undefined);
  t.not(https?.key, undefined);
  t.not(https?.cert, undefined);
  assert(https?.key && https?.cert);
  t.regex(https.key, /^-----BEGIN RSA PRIVATE KEY-----/);
  t.regex(https.cert, /^-----BEGIN CERTIFICATE-----/);
  const key = await fs.readFile(path.join(tmp, "key.pem"), "utf8");
  const cert = await fs.readFile(path.join(tmp, "cert.pem"), "utf8");
  t.is(https.key, key);
  t.is(https.cert, cert);
});
test("HTTPPlugin: setupHttps: generates self-signed certificate at custom location", async (t) => {
  const log = new TestLog();
  const tmpDefault = await useTmp(t);
  const tmpCustom = await useTmp(t);
  const plugin = new HTTPPlugin(
    { ...ctx, log },
    { https: tmpCustom },
    { certRoot: tmpDefault }
  );
  await plugin.setupHttps();
  t.deepEqual(log.logsAtLevel(LogLevel.INFO), [
    "Generating new self-signed certificate...",
  ]);
  const https = plugin.httpsOptions;
  t.not(https, undefined);
  t.not(https?.key, undefined);
  t.not(https?.cert, undefined);
  assert(https?.key && https?.cert);
  t.regex(https.key, /^-----BEGIN RSA PRIVATE KEY-----/);
  t.regex(https.cert, /^-----BEGIN CERTIFICATE-----/);
  t.false(existsSync(path.join(tmpDefault, "key.pem")));
  t.false(existsSync(path.join(tmpDefault, "cert.pem")));
  const key = await fs.readFile(path.join(tmpCustom, "key.pem"), "utf8");
  const cert = await fs.readFile(path.join(tmpCustom, "cert.pem"), "utf8");
  t.is(https.key, key);
  t.is(https.cert, cert);
});
test("HTTPPlugin: setupHttps: reuses existing non-expired certificates", async (t) => {
  const log = new TestLog();
  const tmp = await useTmp(t);
  await fs.writeFile(path.join(tmp, "key.pem"), "existing_key", "utf8");
  await fs.writeFile(path.join(tmp, "cert.pem"), "existing_cert", "utf8");
  const plugin = new HTTPPlugin(
    { ...ctx, log },
    { https: true },
    { certRoot: tmp }
  );
  await plugin.setupHttps();
  t.is(log.logsAtLevel(LogLevel.INFO).length, 0); // Doesn't generate new certificate
  const https = plugin.httpsOptions;
  t.deepEqual(https, {
    key: "existing_key",
    cert: "existing_cert",
    ca: undefined,
    pfx: undefined,
    passphrase: undefined,
  });
});
test("HTTPPlugin: setupHttps: regenerates self-signed certificate if expired", async (t) => {
  const log = new TestLog();
  const tmp = await useTmp(t);
  await fs.writeFile(path.join(tmp, "key.pem"), "expired_key", "utf8");
  await fs.writeFile(path.join(tmp, "cert.pem"), "expired_cert", "utf8");
  const clock: Clock = () => Date.now() + 86400000 * 30; // now + 30 days
  const plugin = new HTTPPlugin(
    { ...ctx, log },
    { https: true },
    { certRoot: tmp, clock }
  );
  await plugin.setupHttps();
  t.deepEqual(log.logsAtLevel(LogLevel.INFO), [
    "Generating new self-signed certificate...",
  ]);
  const https = plugin.httpsOptions;
  t.not(https, undefined);
  t.not(https?.key, undefined);
  t.not(https?.cert, undefined);
  assert(https?.key && https?.cert);
  t.regex(https.key, /^-----BEGIN RSA PRIVATE KEY-----/);
  t.regex(https.cert, /^-----BEGIN CERTIFICATE-----/);
  const key = await fs.readFile(path.join(tmp, "key.pem"), "utf8");
  const cert = await fs.readFile(path.join(tmp, "cert.pem"), "utf8");
  t.is(https.key, key);
  t.is(https.cert, cert);
});

test("HTTPPlugin: setup: sets up cf and https", async (t) => {
  const tmp = await useTmp(t);
  const cfPath = path.join(tmp, "cf.json");
  const { http: upstream } = await useServer(t, (req, res) =>
    res.end('{"colo": "LHR"}')
  );
  const plugin = new HTTPPlugin(
    ctx,
    { cfFetch: true, https: true },
    { certRoot: tmp, cfPath, cfFetch: true, cfFetchEndpoint: upstream }
  );
  await plugin.setup();
  t.deepEqual(await plugin.getRequestMeta({} as any), {
    cf: { colo: "LHR" } as any,
  });
  const https = plugin.httpsOptions;
  assert(https?.key && https?.cert);
  t.regex(https.key, /^-----BEGIN RSA PRIVATE KEY-----/);
  t.regex(https.cert, /^-----BEGIN CERTIFICATE-----/);
});
