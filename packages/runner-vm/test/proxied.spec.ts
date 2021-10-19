import vm from "vm";
import test, { Macro } from "ava";
import { proxiedGlobals } from "../src/proxied";

const instanceOfMacro: Macro<[type: string, create: () => any]> = (
  t,
  type,
  create
) => {
  const ctx = vm.createContext({ ...proxiedGlobals, outside: create() });
  const result = vm.runInContext(
    `({
      outsideInstanceOf: outside instanceof ${type},
      insideInstanceOf: (${create.toString()})() instanceof ${type},
    })`,
    ctx
  );
  t.true(result.outsideInstanceOf, "outside not instanceof");
  t.true(result.insideInstanceOf, "inside not instanceof");
};
instanceOfMacro.title = (providedTitle, type) =>
  `proxiedGlobals: ${type}: supports cross-realm instanceof`;
test(instanceOfMacro, "Object", () => ({ a: 1 }));
test(instanceOfMacro, "Array", () => [1]);
test(instanceOfMacro, "Function", () => () => {});
test(instanceOfMacro, "Promise", () => (async () => {})());
test(instanceOfMacro, "RegExp", () => /a/);
test(instanceOfMacro, "Error", () => new Error());
test(instanceOfMacro, "EvalError", () => new EvalError());
test(instanceOfMacro, "RangeError", () => new RangeError());
test(instanceOfMacro, "ReferenceError", () => new ReferenceError());
test(instanceOfMacro, "SyntaxError", () => new SyntaxError());
test(instanceOfMacro, "TypeError", () => new TypeError());
test(instanceOfMacro, "URIError", () => new URIError());
