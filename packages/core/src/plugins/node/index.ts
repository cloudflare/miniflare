import type { AdditionalModules } from "@miniflare/shared";

import * as assert from "./assert";
import * as async_hooks from "./async_hooks";
import * as buffer from "./buffer";
import * as events from "./events";
import * as util from "./util";

export function additionalNodeModules(experimental: boolean) {
  const modules: AdditionalModules = {
    "node:async_hooks": async_hooks,
    "node:events": events,
  };

  if (experimental) {
    // TODO(soon): remove experimental designations when removed in `workerd`
    modules["node:assert"] = assert;
    modules["node:buffer"] = buffer;
    modules["node:util"] = util;
  }

  return modules;
}
