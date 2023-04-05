import assert from "assert";
import fs from "fs";

const argv = process.argv.slice(2);
assert.strictEqual(argv.length, 2);

fs.createReadStream(argv[0]).pipe(fs.createWriteStream(argv[1]));
