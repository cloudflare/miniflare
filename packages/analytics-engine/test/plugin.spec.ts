import { AnalyticsEnginePlugin } from "@miniflare/analytics-engine";
import {
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
} from "@miniflare/shared-test";
import test from "ava";

test("AnalyticsEnginePlugin: parses options from argv", (t) => {
  const options = parsePluginArgv(AnalyticsEnginePlugin, [
    "--ae",
    "AE1=dataset-1",
    "--ae",
    "AE2=dataset-2",
    "--ae-persist",
    "path",
  ]);
  t.deepEqual(options, {
    analyticsEngines: {
      AE1: "dataset-1",
      AE2: "dataset-2",
    },
    aePersist: "path",
  });
});
test("AnalyticsEnginePlugin: parses options from wrangler config", (t) => {
  const options = parsePluginWranglerConfig(AnalyticsEnginePlugin, {
    bindings: [
      {
        type: "analytics_engine",
        name: "AE1",
        dataset: "dataset-1",
      },
      {
        type: "analytics_engine",
        name: "AE2",
        dataset: "dataset-2",
      },
    ],
    miniflare: { ae_persist: "path" },
  });
  t.deepEqual(options, {
    analyticsEngines: {
      AE1: "dataset-1",
      AE2: "dataset-2",
    },
    aePersist: "path",
  });
});
test("AnalyticsEnginePlugin: logs options", (t) => {
  const logs = logPluginOptions(AnalyticsEnginePlugin, {
    analyticsEngines: {
      AE1: "dataset-1",
      AE2: "dataset-2",
    },
    aePersist: true,
  });
  t.deepEqual(logs, [
    "Analytics Engine Names: AE1, AE2",
    "Analytics Engine Persistence: true",
  ]);
});
