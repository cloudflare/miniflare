const addModule = require("./add.wasm");
const instance = new WebAssembly.Instance(addModule.default);
exports.add1 = (a) => instance.exports.add(a, 1);
