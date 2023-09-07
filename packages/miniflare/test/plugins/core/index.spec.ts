import childProcess from "child_process";
import { once } from "events";
import fs from "fs/promises";
import https from "https";
import { AddressInfo } from "net";
import path from "path";
import { text } from "stream/consumers";
import tls from "tls";
import test from "ava";
import { Miniflare } from "miniflare";
import stoppable from "stoppable";
import which from "which";
import { useTmp } from "../../test-shared";

const opensslInstalled = which.sync("openssl", { nothrow: true });
const opensslTest = opensslInstalled ? test : test.skip;
opensslTest("NODE_EXTRA_CA_CERTS: loads certificates", async (t) => {
  const tmp = await useTmp(t);

  // Generate self-signed certificate
  childProcess.execSync(
    'openssl req -newkey rsa:2048 -nodes -keyout key.pem -x509 -days 30 -out cert.pem -subj "/CN=localhost"',
    { cwd: tmp, stdio: "ignore" }
  );
  const keyPath = path.join(tmp, "key.pem");
  const certPath = path.join(tmp, "cert.pem");
  const key = await fs.readFile(keyPath);
  const cert = await fs.readFile(certPath);

  // Start HTTPS server with self-signed certificate
  const responseBody = "secure body";
  const server = https.createServer({ key, cert }, (req, res) => {
    res.end(responseBody);
  });
  const stoppableServer = stoppable(server, /* grace */ 0);
  const url = await new Promise<string>((resolve) => {
    server.listen(0, () => {
      t.teardown(() => {
        return new Promise((resolve, reject) =>
          stoppableServer.stop((err) => (err ? reject(err) : resolve()))
        );
      });
      const port = (server.address() as AddressInfo).port;
      resolve(`https://localhost:${port}`);
    });
  });

  // Write NODE_EXTRA_CA_CERTS file, with multiple certificates
  // (see https://github.com/cloudflare/miniflare/pull/587/files#r1271579671)
  const caCertsPath = path.join(tmp, "bundle.pem");
  const caCerts = [...tls.rootCertificates, cert];
  await fs.writeFile(caCertsPath, caCerts.join("\n"));

  // Start Miniflare with NODE_EXTRA_CA_CERTS environment variable
  // (cannot use sync process methods here as that would block HTTPS server)
  const result = childProcess.spawn(
    process.execPath,
    [
      "-e",
      `
      const { Miniflare } = require("miniflare");
      const mf = new Miniflare({
        verbose: true,
        modules: true,
        script: \`export default {
          fetch() {
            return fetch(${JSON.stringify(url)});
          }
        }\`
      });
      (async () => {
        const res = await mf.dispatchFetch("http://placeholder/");
        const text = await res.text();
        console.log(text);
        await mf.dispose();
      })();
      `,
    ],
    {
      stdio: [/* in */ "ignore", /* out */ "pipe", /* error */ "inherit"],
      env: { NODE_EXTRA_CA_CERTS: caCertsPath },
    }
  );

  // Check response matches expected
  const exitPromise = once(result, "exit");
  const resultText = await text(result.stdout);
  await exitPromise;
  t.is(result.exitCode, 0);
  t.is(resultText.trim(), responseBody);
});

test("Miniflare: dispatch namespace binding", async (t) => {
  const mf = new Miniflare({
    workers: [
      {
        name: "main",
        modules: true,
        script: `export default {
          async fetch(request, env, ctx) {
            const userWorker = env.dispatcher.get("foo");
            return await userWorker.fetch(request);
          }
        }`,
        dispatchNamespaceBindings: {
          dispatcher: {
            users: [
              {
                name: "foo",
                worker: "user:foo",
              },
            ],
          },
        },
      },
      {
        name: "user:foo",
        modules: true,
        script: `export default {
          async fetch(request, env, ctx) {
            return new Response("I am a user");
          }
        }`,
      },
    ],
    compatibilityDate: "2023-03-01",
  });
  t.teardown(() => mf.dispose());
  const resp = await mf.dispatchFetch("http://localhost");
  t.deepEqual(await resp.text(), "I am a user");
});

test("Miniflare: dispatch namespace binding with outbound", async (t) => {
  const mf = new Miniflare({
    workers: [
      {
        name: "dispatch",
        modules: true,
        script: `export default {
          async fetch(request, env, ctx) {
            const userWorker = env.dispatcher.get("foo", {}, {
              outbound: {
                params: {
                  "o": "outboundVal",
                },
              },
            });
            return await userWorker.fetch(request);
          }
        }`,
        dispatchNamespaceBindings: {
          dispatcher: {
            users: [
              {
                name: "foo",
                worker: "foo",
              },
            ],
            outbound: {
              service: {
                name: "myoutbound",
                worker: "myoutbound",
              },
              parameters: ["params"],
            },
          },
        },
      },
      {
        name: "foo",
        modules: true,
        script: `export default {
          async fetch(request, env, ctx) {
            return new Response("I am a user");
          }
        }`,
      },
      {
        name: "myoutbound",
        modules: true,
        script: `export default {
          async fetch(request, env, ctx) {
            await env.KV.put("hitOutbound", "yes");
            await env.KV.put("outboundParamVal", env.o);
            return new Response("outbound");
          }
        }`,
        kvNamespaces: ["KV"],
      },
    ],
    compatibilityDate: "2023-03-01",
  });
  t.teardown(() => mf.dispose());
  const resp = await mf.dispatchFetch("http://localhost");
  t.deepEqual(await resp.text(), "I am a user");

  const kv = await mf.getKVNamespace("KV", "myoutbound");
  t.deepEqual(await kv.get("hitOutbound"), "yes");
  t.deepEqual(await kv.get("outboundParamVal"), "outboundVal");
});
