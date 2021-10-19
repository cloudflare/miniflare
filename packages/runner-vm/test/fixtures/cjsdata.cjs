const data = require("./data.bin");
module.exports = `CommonJS ${new TextDecoder().decode(data.default).trimEnd()}`;
