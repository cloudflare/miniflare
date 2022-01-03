/* eslint-disable @typescript-eslint/ban-types */
import { types } from "util";

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
    if (!types.isNativeError(value)) return false;
    // Traverse up prototype chain and check for matching name
    let prototype = value;
    while ((prototype = Object.getPrototypeOf(prototype)) !== null) {
      if (prototype.name === name) return true;
    }
    return false;
  };
}

function proxyHasInstance<T extends object>(
  target: T,
  hasInstance: (value: any) => boolean,
  handler?: ProxyHandler<T>
) {
  return new Proxy<T>(target, {
    get(target, property, receiver) {
      if (property === Symbol.hasInstance) return hasInstance;
      return Reflect.get(target, property, receiver);
    },
    ...handler,
  });
}

// See `CorePlugin` in `/packages/core/src/plugins/core.ts` for an explanation
// of what this function does and why it's needed.
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function makeProxiedGlobals(blockCodeGeneration?: boolean) {
  if (!blockCodeGeneration) blockCodeGeneration = undefined;
  return {
    Object: proxyHasInstance(Object, isObject),
    Array: proxyHasInstance(Array, Array.isArray),
    Promise: proxyHasInstance(Promise, types.isPromise),
    RegExp: proxyHasInstance(RegExp, types.isRegExp),
    Error: proxyHasInstance(Error, isError(Error)),
    EvalError: proxyHasInstance(EvalError, isError(EvalError)),
    RangeError: proxyHasInstance(RangeError, isError(RangeError)),
    ReferenceError: proxyHasInstance(ReferenceError, isError(ReferenceError)),
    SyntaxError: proxyHasInstance(SyntaxError, isError(SyntaxError)),
    TypeError: proxyHasInstance(TypeError, isError(TypeError)),
    URIError: proxyHasInstance(URIError, isError(URIError)),
    Function: proxyHasInstance(
      Function,
      isFunction,
      blockCodeGeneration && {
        construct() {
          // We set `codeGeneration: { strings: false }` in our vm context, but
          // because we're passing the Function constructor from outside the
          // realm, we have to prevent construction ourselves.
          //
          // Constructing with the Function constructor obtained from
          // `Object.getPrototypeOf(function(){}).constructor` will still throw
          // though because of `strings: false`.
          throw new EvalError(
            "Code generation from strings disallowed for this context"
          );
        },
      }
    ),
  };
}
