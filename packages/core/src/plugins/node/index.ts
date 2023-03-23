import type { AdditionalModules } from "@miniflare/shared";

import * as assert from "./assert";
import * as async_hooks from "./async_hooks";
import * as buffer from "./buffer";
import * as events from "./events";
import * as util from "./util";

export function additionalNodeModules(_experimental: boolean) {
  const modules: AdditionalModules = {
    "node:assert": assert,
    "node:async_hooks": async_hooks,
    "node:buffer": buffer,
    "node:events": events,
    "node:util": util,
  };

  return modules;
}
