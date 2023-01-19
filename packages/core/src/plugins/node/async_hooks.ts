import async_hooks from "node:async_hooks";

export class AsyncHooksModule {
  AsyncLocalStorage = async_hooks.AsyncLocalStorage;
  AsyncResource = async_hooks.AsyncResource;
}
