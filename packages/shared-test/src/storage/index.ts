import * as deleteMacrosObject from "./delete";
import * as getMacrosObject from "./get";
import * as getRangeMacrosObject from "./getRange";
import * as hasMacrosObject from "./has";
import * as headMacrosObject from "./head";
import * as listMacrosObject from "./list";
import * as putMacrosObject from "./put";

export const storageMacros = [
  ...Object.values(deleteMacrosObject),
  ...Object.values(getMacrosObject),
  ...Object.values(getRangeMacrosObject),
  ...Object.values(hasMacrosObject),
  ...Object.values(headMacrosObject),
  ...Object.values(listMacrosObject),
  ...Object.values(putMacrosObject),
];

export * from "./factory";
export * from "./recorder";
export * from "./shared";
