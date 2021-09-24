import * as deleteMacrosObject from "./delete";
import * as getMacrosObject from "./get";
import * as hasMacrosObject from "./has";
import * as listMacrosObject from "./list";
import * as putMacrosObject from "./put";
import * as txnMacrosObject from "./transaction";

export const operatorMacros = [
  ...Object.values(deleteMacrosObject),
  ...Object.values(getMacrosObject),
  ...Object.values(hasMacrosObject),
  ...Object.values(listMacrosObject),
  ...Object.values(putMacrosObject),
];

export const txnMacros = Object.values(txnMacrosObject);

export * from "./shared";
