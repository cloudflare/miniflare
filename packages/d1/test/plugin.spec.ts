import { createCrypto } from "@miniflare/core";
import { D1Plugin } from "@miniflare/d1";
import {
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
} from "@miniflare/shared-test";
import test from "ava";

const crypto = createCrypto();

test("D1Plugin: parses options from argv", (t) => {
  const options = parsePluginArgv(D1Plugin, [
    "--d1",
    "DB1",
    "--d1",
    "DB2",
    "--d1-persist",
    "path",
  ]);
  t.deepEqual(options, {
    d1Databases: ["DB1", "DB2"],
    d1Persist: "path",
  });
});
test("D1Plugin: parses options from wrangler config", (t) => {
  const options = parsePluginWranglerConfig(D1Plugin, {
    d1_databases: [
      {
        binding: "DB1",
        database_name: "data-base-1",
        database_id: crypto.randomUUID(),
      },
      {
        binding: "DB2",
        database_name: "data-base-2",
        database_id: crypto.randomUUID(),
      },
    ],
    miniflare: { d1_persist: "path" },
  });
  t.deepEqual(options, {
    d1Databases: ["DB1", "DB2"],
    d1Persist: "path",
  });
});
test("D1Plugin: logs options", (t) => {
  const logs = logPluginOptions(D1Plugin, {
    d1Databases: ["DB1", "DB2"],
    d1Persist: true,
  });
  t.deepEqual(logs, ["D1 Namespaces: DB1, DB2", "D1 Persistence: true"]);
});
