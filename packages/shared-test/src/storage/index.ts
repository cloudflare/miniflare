import * as deleteMacrosObject from "./delete";
import * as getMacrosObject from "./get";
import * as hasMacrosObject from "./has";
import * as listMacrosObject from "./list";
import * as putMacrosObject from "./put";

export const storageMacros = [
  ...Object.values(deleteMacrosObject),
  ...Object.values(getMacrosObject),
  ...Object.values(hasMacrosObject),
  ...Object.values(listMacrosObject),
  ...Object.values(putMacrosObject),
];

export * from "./factory";
export * from "./recorder";
export * from "./shared";
