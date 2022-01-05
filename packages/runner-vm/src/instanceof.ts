/* eslint-disable @typescript-eslint/ban-types */
// Object, Function, Array, Promise, RegExp, Error, EvalError, RangeError,
// ReferenceError, SyntaxError, TypeError and URIError are intentionally
// not passed into the sandbox. There's a trade-off here, ideally we'd like all
// these checks to pass:
//
// ```js
// import vm from "vm";
//
// const ctx1 = vm.createContext({ objectFunction: () => ({}) });
//
// vm.runInContext("({}) instanceof Object", ctx1); // true
// vm.runInContext("({}).constructor === Object", ctx1); // true
//
// vm.runInContext("objectFunction() instanceof Object", ctx1); // false
// vm.runInContext("objectFunction().constructor === Object", ctx1); // false
//
// const ctx2 = vm.createContext({ Object: Object, objectFunction: () => ({}) });
//
// vm.runInContext("({}) instanceof Object", ctx2); // false
// vm.runInContext("({}).constructor === Object", ctx2); // false
//
// vm.runInContext("objectFunction() instanceof Object", ctx2); // true
// vm.runInContext("objectFunction().constructor === Object", ctx2); // true
// ```
//
// wasm-bindgen (a tool used to make compiling Rust to WebAssembly easier),
// often generates code that looks like `value instanceof Object`.
// We'd like this check to succeed for objects generated outside the worker
// (e.g. Workers runtime APIs), and inside user code (instances of classes we
// pass in e.g. `new Uint8Array()`, and literals e.g. `{}`). To do this, we
// override the `[Symbol.hasInstance]` property of primitive classes like
// `Object` so `instanceof` performs a cross-realm check.
// See `defineHasInstancesScript` later in this file.
//
// Historically, we used to do this by proxying the primitive classes instead:
//
// ```js
// function isObject(value) {
//   return value !== null && typeof value === "object";
// }
//
// const ObjectProxy = new Proxy(Object, {
//   get(target, property, receiver) {
//     if (property === Symbol.hasInstance) return isObject;
//     return Reflect.get(target, property, receiver);
//   },
// });
//
// const ctx3 = vm.createContext({
//   Object: ObjectProxy,
//   objectFunction: () => ({}),
// });
//
// vm.runInContext("({}) instanceof Object", ctx3); // true
// vm.runInContext("({}).constructor === Object", ctx3); // false
//
// vm.runInContext("objectFunction() instanceof Object", ctx3); // true
// vm.runInContext("objectFunction().constructor === Object", ctx3); // false
// ```
//
// The problem with this option is that the `constructor`/`prototype` checks
// fail, because we're passing in the `Object` from the outer realm.
// These are used quite a lot in JS, and this was the cause of several issues:
// - https://github.com/cloudflare/miniflare/issues/109
// - https://github.com/cloudflare/miniflare/issues/137
// - https://github.com/cloudflare/miniflare/issues/141
// - https://github.com/cloudflare/wrangler2/issues/91
//
// The new behaviour still has the issue `constructor`/`prototype`/`instanceof`
// checks for `Object`s created outside the sandbox would fail, but I think
// that's less likely to be a problem.

import util from "util";
import vm from "vm";

// https://nodejs.org/api/util.html#util_util_isobject_object
function isObject(value: any): value is Object {
  return value !== null && typeof value === "object";
}

// https://nodejs.org/api/util.html#util_util_isfunction_object
function isFunction(value: any): value is Function {
  return typeof value === "function";
}

function isError<Ctor extends ErrorConstructor>(errorCtor: Ctor) {
  const name = errorCtor.prototype.name;
  return function (value: any): value is InstanceType<Ctor> {
    if (!util.types.isNativeError(value)) return false;
    // Traverse up prototype chain and check for matching name
    let prototype = value;
    while ((prototype = Object.getPrototypeOf(prototype)) !== null) {
      if (prototype.name === name) return true;
    }
    return false;
  };
}

const types = {
  isObject,
  isFunction,
  isArray: Array.isArray,
  isPromise: util.types.isPromise,
  isRegExp: util.types.isRegExp,
  isError,
};

const defineHasInstancesScript = new vm.Script(
  `(function(types) {
  // Only define properties once, will throw if we try doing this twice
  if (Object[Symbol.hasInstance] === types.isObject) return;
  Object.defineProperty(Object, Symbol.hasInstance, { value: types.isObject });
  Object.defineProperty(Function, Symbol.hasInstance, { value: types.isFunction });
  Object.defineProperty(Array, Symbol.hasInstance, { value: types.isArray });
  Object.defineProperty(Promise, Symbol.hasInstance, { value: types.isPromise });
  Object.defineProperty(RegExp, Symbol.hasInstance, { value: types.isRegExp });
  Object.defineProperty(Error, Symbol.hasInstance, { value: types.isError(Error) });
  Object.defineProperty(EvalError, Symbol.hasInstance, { value: types.isError(EvalError) });
  Object.defineProperty(RangeError, Symbol.hasInstance, { value: types.isError(RangeError) });
  Object.defineProperty(ReferenceError, Symbol.hasInstance, { value: types.isError(ReferenceError) });
  Object.defineProperty(SyntaxError, Symbol.hasInstance, { value: types.isError(SyntaxError) });
  Object.defineProperty(TypeError, Symbol.hasInstance, { value: types.isError(TypeError) });
  Object.defineProperty(URIError, Symbol.hasInstance, { value: types.isError(URIError) });
})`,
  { filename: "<defineHasInstancesScript>" }
);

// This is called on each new vm.Context before executing arbitrary user code
export function defineHasInstances(ctx: vm.Context): void {
  defineHasInstancesScript.runInContext(ctx)(types);
}
