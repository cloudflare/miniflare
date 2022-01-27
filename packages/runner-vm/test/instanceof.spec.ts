import vm from "vm";
import { defineHasInstances } from "@miniflare/runner-vm";
import test, { Macro } from "ava";

const instanceOfMacro: Macro<
  [type: string, create: () => any, invert?: boolean]
> = (t, type, create, invert) => {
  const ctx = vm.createContext({ outside: create() });
  defineHasInstances(ctx);
  const result = vm.runInContext(
    `({
      outsideInstanceOf: outside instanceof ${type},
      insideInstanceOf: (${create.toString()})() instanceof ${type},
    })`,
    ctx
  );
  const assert = invert ? t.false : t.true;
  const message = invert ? "instanceof" : "not instanceof";
  assert(result.outsideInstanceOf, "outside " + message);
  assert(result.insideInstanceOf, "inside " + message);
};
instanceOfMacro.title = (providedTitle, type) =>
  `proxiedGlobals: ${type}: supports ${
    providedTitle ?? "cross-realm instanceof"
  }`;
test(instanceOfMacro, "Object", () => ({ a: 1 }));
test(instanceOfMacro, "Array", () => [1]);
test(instanceOfMacro, "Promise", () => (async () => {})());
test(instanceOfMacro, "RegExp", () => /a/);
test(instanceOfMacro, "Error", () => new Error());
test(instanceOfMacro, "EvalError", () => new EvalError());
test(instanceOfMacro, "RangeError", () => new RangeError());
test(instanceOfMacro, "ReferenceError", () => new ReferenceError());
test(instanceOfMacro, "SyntaxError", () => new SyntaxError());
test(instanceOfMacro, "TypeError", () => new TypeError());
test(instanceOfMacro, "URIError", () => new URIError());
test(instanceOfMacro, "Function", () => () => {});

test(
  "subclass cross-realm instanceof",
  instanceOfMacro,
  "Error",
  () => new RangeError()
);
test(
  "not instanceof",
  instanceOfMacro,
  "EvalError",
  () => new TypeError(),
  true
);

test("Object instanceof Object", instanceOfMacro, "Object", () => Object);
test("Function instanceof Object", instanceOfMacro, "Object", () => Function);
test(
  "Function instanceof Function",
  instanceOfMacro,
  "Function",
  () => Function
);
test(
  "undefined not instanceof Object",
  instanceOfMacro,
  "Object",
  () => undefined,
  true
);
test("null not instanceof Object", instanceOfMacro, "Object", () => null, true);

test("calling defineHasInstances on same context multiple times doesn't throw", (t) => {
  const ctx = vm.createContext({});
  defineHasInstances(ctx);
  defineHasInstances(ctx);
  t.pass();
});

test("Error subclasses have correct instanceof behaviour", (t) => {
  // https://github.com/cloudflare/miniflare/issues/159
  const ctx = vm.createContext({});
  defineHasInstances(ctx);
  const result = vm.runInContext(
    `
    class CustomError extends Error {}
    ({
      errorInstanceOfError: new Error() instanceof Error,
      errorInstanceOfTypeError: new Error() instanceof TypeError,
      errorInstanceOfCustomError: new Error() instanceof CustomError,
      
      typeErrorInstanceOfError: new TypeError() instanceof Error,
      typeErrorInstanceOfTypeError: new TypeError() instanceof TypeError,
      typeErrorInstanceOfCustomError: new TypeError() instanceof CustomError,
      
      customErrorInstanceOfError: new CustomError() instanceof Error,
      customErrorInstanceOfTypeError: new CustomError() instanceof TypeError,
      customErrorInstanceOfCustomError: new CustomError() instanceof CustomError,
    })
    `,
    ctx
  );
  t.deepEqual(result, {
    errorInstanceOfError: true,
    errorInstanceOfTypeError: false,
    errorInstanceOfCustomError: false,

    typeErrorInstanceOfError: true,
    typeErrorInstanceOfTypeError: true,
    typeErrorInstanceOfCustomError: false,

    customErrorInstanceOfError: true,
    customErrorInstanceOfTypeError: false,
    customErrorInstanceOfCustomError: true,
  });
});
