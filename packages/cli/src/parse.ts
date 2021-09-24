import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  MiniflareError,
  OptionMetadata,
  OptionType,
  Options,
  PluginSignatures,
} from "@miniflare/shared";
import mri from "mri";
import { argName } from "./helpers";

interface Arg {
  name: string;
  key: string;
  meta: OptionMetadata;
}

type ArgValue = boolean | number | string;
type ArgValues = ArgValue | ArgValue[] | undefined;

export type ParseErrorCode =
  | "ERR_HELP" // Help requested
  | "ERR_VERSION" // Version number requested, message will be version number
  | "ERR_OPTION" // Unexpected option received
  | "ERR_VALUE"; // Unexpected value received for expected option

export class ParseError extends MiniflareError<ParseErrorCode> {}

export function parseArgv<Plugins extends PluginSignatures>(
  plugins: Plugins,
  argv: string[]
): Options<Plugins> {
  // Name of single positional argument if any, won't have "--" prepended if
  // unexpected value received
  let positionalName = "";
  // Args that should always be passed as booleans or strings
  const booleans: string[] = ["help", "version"];
  const strings: string[] = [];
  // Short arg names, all args must be included (even if the value is just [])
  // so mri knows which ones are unexpected
  const aliases: Record<string, string | string[]> = {
    help: "h",
    version: "v",
  };
  const args: Arg[] = [];
  for (const plugin of Object.values(plugins)) {
    // Skip section if no options
    if (plugin.prototype.opts === undefined) continue;
    for (const [key, meta] of plugin.prototype.opts.entries()) {
      const type = meta.type;
      // Ignore API-only options (e.g. string script)
      if (type === OptionType.NONE) continue;

      // Record arg so we can construct result options object later, note we're
      // including positional arguments here so they're included in the result
      const name = argName(key, meta);
      args.push({ name, key, meta });

      if (type === OptionType.STRING_POSITIONAL) {
        positionalName = name;
        // Positional arguments shouldn't be parsed as flag (so not in aliases)
        continue;
      }
      if (type === OptionType.BOOLEAN) {
        booleans.push(name);
      }
      if (
        type === OptionType.STRING ||
        type === OptionType.ARRAY ||
        type === OptionType.OBJECT
      ) {
        strings.push(name);
      }

      // [] means no aliases, but still expected flag
      aliases[name] = meta.alias ?? [];
    }
  }
  // Actually parse argv
  const parsed = mri(argv, {
    boolean: booleans,
    string: strings,
    alias: aliases,
    unknown(flag) {
      // Called once on first unexpected flag
      throw new ParseError("ERR_OPTION", `Unexpected option: ${flag}`);
    },
  });

  // If help or version requested, ignore other options
  if (parsed.help) throw new ParseError("ERR_HELP");
  if (parsed.version) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const pkgPath = path.join(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    throw new ParseError("ERR_VERSION", pkg.version);
  }

  // Helper function to throw unexpected value error
  function unexpected(
    name: string,
    value: ArgValues,
    expectedType: string
  ): never {
    // Flags should be prefixed with "--"
    if (name !== positionalName) name = `--${name}`;
    const message =
      `Unexpected value for ${name}: ` +
      JSON.stringify(value) +
      ` (expected ${expectedType})`;
    throw new ParseError("ERR_VALUE", message);
  }

  const result = {} as Options<Plugins>;
  for (const { name, key, meta } of args) {
    const { type, typeFormat, fromEntries } = meta;
    let value: ArgValues = parsed[name];
    if (type === OptionType.STRING_POSITIONAL) {
      // If this is the positional argument, get the value from ._ instead.
      // There can only be <= 1 positional argument, if there's more, set the
      // value to the full array, the validation below will throw a parse error.
      if (parsed._.length === 1) value = parsed._[0];
      else if (parsed._.length > 1) value = parsed._ as string[];
    }
    // Don't store undefined options in result. If we did, these would override
    // anything from wrangler configs.
    if (value === undefined) continue;
    // Validate option's value
    let parsedValue: any = value;
    if (type === OptionType.BOOLEAN) {
      // These args will be in the `booleans` array, so mri will ignore anything
      // following the flag. We just don't want arrays.
      if (typeof value !== "boolean") unexpected(name, value, "boolean");
    } else if (type === OptionType.NUMBER) {
      // We don't want booleans, strings, or arrays
      if (typeof value !== "number") unexpected(name, value, "number");
    } else if (
      type === OptionType.STRING ||
      type === OptionType.STRING_POSITIONAL
    ) {
      // These args will be in the `strings` array, so mri will automatically
      // convert booleans/numbers to strings. We just don't want arrays.
      if (typeof value !== "string") unexpected(name, value, "string");
    } else if (type === OptionType.BOOLEAN_STRING) {
      if (Array.isArray(value)) unexpected(name, value, "boolean/string");
      // Numbers should be treated as strings
      if (typeof value === "number") parsedValue = value.toString();
    } else if (type === OptionType.ARRAY || type === OptionType.OBJECT) {
      // If single item passed, value won't be an array, but it should be
      if (!Array.isArray(value)) value = [value];
      // Make sure every item is a string (may be booleans/numbers)
      const array = value.map<string>((element) => element.toString());
      if (type === OptionType.OBJECT) {
        // Make sure every item is a valid key/value pair
        parsedValue = array.map<[key: string, value: string]>((element) => {
          const equals = element.indexOf("=");
          if (equals === -1) {
            // If we couldn't find =, this isn't a valid key/value pair
            unexpected(name, element, typeFormat ?? "KEY=VALUE");
          }
          return [element.substring(0, equals), element.substring(equals + 1)];
        });
        // Convert to object, allowing this to be overridden in case multiple
        // values for the same key are allowed (e.g. modules rules)
        parsedValue = (fromEntries ?? Object.fromEntries)(parsedValue);
      } else {
        // If this is just an array, store the string array as is
        parsedValue = array;
      }
    }
    (result as any)[key] = parsedValue;
  }

  return result;
}
