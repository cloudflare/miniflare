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
// (e.g. Workers runtime APIs, instances of classes we pass e.g.
// `new Uint8Array()`), and inside user code (literals e.g. `{}`). To do this,
// we override the `[Symbol.hasInstance]` property of primitive classes like
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
// The new behaviour still has the issue `constructor`/`prototype` checks for
// `Object`s created outside the sandbox would fail, but I think that's less
// likely to be a problem, since the types should always be known in this case.
// The user can also pass in the classes themselves from Node.js as custom
// globals, and they'll override the inner realm's ones.

import vm from "vm";
import { ValueOf } from "@miniflare/shared";

// https://tc39.es/ecma262/multipage/abstract-operations.html#sec-ordinaryhasinstance
function ordinaryHasInstance(C: unknown, O: unknown): boolean {
  // 1. If IsCallable(C) is false, return false.
  //    - https://tc39.es/ecma262/multipage/abstract-operations.html#sec-iscallable
  //    - https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#table-typeof-operator-results
  if (typeof C !== "function") return false;
  // 2. If C has a [[BoundTargetFunction]] internal slot, ... (IGNORED)
  // 3. If Type(O) is not Object, return false.
  if (typeof O !== "object" && typeof O !== "function") return false;
  if (O === null) return false;
  // 4. Let P be ? Get(C, "prototype").
  const P = C.prototype;
  // 5. If Type(P) is not Object, throw a TypeError exception.
  if (typeof P !== "object" && typeof P !== "function") {
    throw new TypeError(
      `Function has non-object prototype '${P}' in instanceof check`
    );
  }
  // 6. Repeat,
  //    a. Set O to ? O.[[GetPrototypeOf]]().
  //    b. If O is null, return false.
  while ((O = Object.getPrototypeOf(O)) !== null) {
    //  c. If SameValue(P, O) is true, return true.
    if (P === O) return true;
  }
  return false;
}

// https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-instanceofoperator
function instanceOf(V: any, insideTarget: any, outsideTarget: any): boolean {
  // 1. If Type(target) is not Object, throw a TypeError exception. (IGNORED: we always know target ahead of time)
  // 2. Let instOfHandler be ? GetMethod(target, @@hasInstance). (IGNORED: we're overriding Symbol.hasInstance ourselves)
  // 3. If instOfHandler is not undefined, ... (IGNORED: we're overriding Symbol.hasInstance ourselves)
  // 4. If IsCallable(target) is false, throw a TypeError exception. (IGNORED: we always know target ahead of time)
  // 5. Return ? OrdinaryHasInstance(target, V).
  return (
    ordinaryHasInstance(insideTarget, V) ||
    ordinaryHasInstance(outsideTarget, V)
  );
}

const outsideTargets = {
  Object,
  Function,
  Array,
  Promise,
  RegExp,
  Error,
  EvalError,
  RangeError,
  ReferenceError,
  SyntaxError,
  TypeError,
  URIError,
};

function defineHasInstance(insideTarget: ValueOf<typeof outsideTargets>) {
  Object.defineProperty(insideTarget, Symbol.hasInstance, {
    value(value: any) {
      const outsideTarget =
        outsideTargets[this.name as keyof typeof outsideTargets];
      return instanceOf(value, this, outsideTarget);
    },
  });
}

const defineHasInstancesScript = new vm.Script(
  `(function(defineHasInstance) {
  // Only define properties once, would throw if we tried doing this twice
  if (Object.hasOwnProperty(Symbol.hasInstance)) return;
  defineHasInstance(Object);
  defineHasInstance(Function);
  defineHasInstance(Array);
  defineHasInstance(Promise);
  defineHasInstance(RegExp);
  defineHasInstance(Error);
})`,
  { filename: "<defineHasInstancesScript>" }
);

// This is called on each new vm.Context before executing arbitrary user code
export function defineHasInstances(ctx: vm.Context): void {
  defineHasInstancesScript.runInContext(ctx)(defineHasInstance);
}
