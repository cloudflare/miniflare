import { AnalyticsEnginePlugin } from "@miniflare/analytics-engine";
import { createCrypto } from "@miniflare/core";
import {
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
} from "@miniflare/shared-test";
import test from "ava";

const crypto = createCrypto();

test("AnalyticsEnginePlugin: parses options from argv", (t) => {
  const options = parsePluginArgv(AnalyticsEnginePlugin, [
    "--analyticsEngine",
    "AE1",
    "--analyticsEngine",
    "AE2",
    "--ae-persist",
    "path",
  ]);
  t.deepEqual(options, {
    analyticsEngines: ["AE1", "AE2"],
    aePersist: "path",
  });
});
test("AnalyticsEnginePlugin: parses options from wrangler config", (t) => {
  const options = parsePluginWranglerConfig(AnalyticsEnginePlugin, {
    analytics_engines: [
      {
        binding: "AE1",
        name: "data-base-1",
        dataset: crypto.randomUUID(),
      },
      {
        binding: "AE2",
        name: "data-base-2",
        dataset: crypto.randomUUID(),
      },
    ],
    miniflare: { ae_persist: "path" },
  });
  t.deepEqual(options, {
    analyticsEngines: ["AE1", "AE2"],
    aePersist: "path",
  });
});
test("AnalyticsEnginePlugin: logs options", (t) => {
  const logs = logPluginOptions(AnalyticsEnginePlugin, {
    analyticsEngines: ["AE1", "AE2"],
    aePersist: true,
  });
  t.deepEqual(logs, [
    "Analytics Engine Namespaces: AE1, AE2",
    "Analytics Engine Persistence: true",
  ]);
});
