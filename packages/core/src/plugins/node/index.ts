import { AsyncHooksModule } from "./async_hooks";

export const additionalModules = {
  "node:async_hooks": { default: new AsyncHooksModule() },
};
