import { Data, List, Message, Struct } from "capnp-ts";
import { Config, kVoid } from "./workerd";
import { Config as CapnpConfig } from "./workerd.capnp.js";

function capitalize<S extends string>(str: S): Capitalize<S> {
  return (
    str.length > 0 ? str[0].toUpperCase() + str.substring(1) : str
  ) as Capitalize<S>;
}

// Dynamically encode a capnp struct based on keys and the types of values.
// `obj` should be an instance of a type in `./workerd.ts`. The safety of
// this function relies on getting `./workerd.ts` correct, TypeScript's type
// safety guarantees, and us validating all user input with zod.
//
// TODO: generate `./workerd.ts` and corresponding encoders automatically
//  from the `.capnp` file.
function encodeCapnpStruct(obj: any, struct: Struct) {
  const anyStruct = struct as any;
  for (const [key, value] of Object.entries(obj)) {
    const capitalized = capitalize(key);
    if (value instanceof Uint8Array) {
      const newData: Data = anyStruct[`init${capitalized}`](value.byteLength);
      newData.copyBuffer(value);
    } else if (Array.isArray(value)) {
      const newList: List<any> = anyStruct[`init${capitalized}`](value.length);
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] === "object") {
          encodeCapnpStruct(value[i], newList.get(i));
        } else {
          newList.set(i, value[i]);
        }
      }
    } else if (typeof value === "object") {
      const newStruct: Struct = anyStruct[`init${capitalized}`]();
      encodeCapnpStruct(value, newStruct);
    } else if (value === kVoid) {
      anyStruct[`set${capitalized}`]();
    } else if (value !== undefined) {
      // Ignore all `undefined` values, explicitly `undefined` values should use
      // kVoid symbol instead.
      anyStruct[`set${capitalized}`](value);
    }
  }
}

export function serializeConfig(config: Config): Buffer {
  const message = new Message();
  const struct = message.initRoot(CapnpConfig);
  encodeCapnpStruct(config, struct);
  return Buffer.from(message.toArrayBuffer());
}

export * from "./workerd";
