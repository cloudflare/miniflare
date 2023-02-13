import {
  // @ts-expect-error `_extend` is deprecated, but exported by `node:util`
  // https://nodejs.org/api/util.html#util_extendtarget-source
  _extend,
  callbackify,
  format,
  inherits,
  promisify,
  types,
} from "node:util";

export { types, callbackify, promisify, format, inherits, _extend };

export default {
  types,
  callbackify,
  promisify,
  format,
  inherits,
  _extend,
};
