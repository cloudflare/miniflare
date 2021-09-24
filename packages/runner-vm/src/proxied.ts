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
  return function (value: any): value is InstanceType<Ctor> {
    return (
      types.isNativeError(value) &&
      Object.getPrototypeOf(value).name === errorCtor.prototype.name
    );
  };
}

function proxyHasInstance<T extends object>(
  target: T,
  hasInstance: (value: any) => boolean
) {
  return new Proxy<T>(target, {
    get(target, property, receiver) {
      if (property === Symbol.hasInstance) return hasInstance;
      return Reflect.get(target, property, receiver);
    },
  });
}

export const proxiedGlobals = {
  Object: proxyHasInstance(Object, isObject),
  Array: proxyHasInstance(Array, Array.isArray),
  Function: proxyHasInstance(Function, isFunction),
  Promise: proxyHasInstance(Promise, types.isPromise),
  RegExp: proxyHasInstance(RegExp, types.isRegExp),
  Error: proxyHasInstance(Error, isError(Error)),
  EvalError: proxyHasInstance(EvalError, isError(EvalError)),
  RangeError: proxyHasInstance(RangeError, isError(RangeError)),
  ReferenceError: proxyHasInstance(ReferenceError, isError(ReferenceError)),
  SyntaxError: proxyHasInstance(SyntaxError, isError(SyntaxError)),
  TypeError: proxyHasInstance(TypeError, isError(TypeError)),
  URIError: proxyHasInstance(URIError, isError(URIError)),
};
