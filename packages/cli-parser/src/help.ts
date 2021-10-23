import {
  OptionMetadata,
  OptionType,
  PluginSignatures,
  spaceCase,
} from "@miniflare/shared";
import { bold, grey } from "kleur/colors";
import { argName } from "./helpers";

interface HelpLine {
  alias: string | undefined;
  name: string;
  description: string;
  typeName: string;
}

const helpMeta: OptionMetadata = {
  type: OptionType.BOOLEAN,
  alias: "h",
  description: "Show help",
};
const versionMeta: OptionMetadata = {
  type: OptionType.BOOLEAN,
  alias: "v",
  description: "Show version number",
};

export function buildHelp<Plugins extends PluginSignatures>(
  plugins: Plugins,
  exec: string
): string {
  // Name of single positional argument if any
  let positionalName = "";
  // Max lengths of name and description fields for formatting table
  let maxNameLength = 0;
  let maxDescriptionLength = 0;
  const sections: [sectionName: string, pluginLines: HelpLine[]][] = [];

  for (const [pluginName, plugin] of Object.entries(plugins)) {
    // Skip section if no options
    if (plugin.prototype.opts === undefined) continue;
    const pluginLines: HelpLine[] = [];
    // Convert KVPlugin -> KV Options
    const sectionName = spaceCase(pluginName.replace("Plugin", "Options"));
    const entries = [...plugin.prototype.opts.entries()];
    if (sectionName === "Core Options") {
      // Include help and version in "Core Options" sections
      entries.unshift(["help", helpMeta], ["version", versionMeta]);
    }

    for (const [key, meta] of entries) {
      const { type, typeFormat, alias, description = "" } = meta;
      // Ignore API-only options (e.g. string script)
      if (type === OptionType.NONE) continue;

      const name = argName(key, meta);
      if (type === OptionType.STRING_POSITIONAL) {
        positionalName = name;
        // Positional arguments shouldn't appear in options list
        continue;
      }

      if (name.length > maxNameLength) {
        maxNameLength = name.length;
      }
      if (description.length > maxDescriptionLength) {
        maxDescriptionLength = description.length;
      }

      // Convert OptionType.ARRAY -> array
      let typeName = OptionType[type].toLowerCase();
      if (type === OptionType.BOOLEAN_STRING) typeName = "boolean/string";
      if (type === OptionType.OBJECT) {
        typeName = `array:${typeFormat ?? "KEY=VALUE"}`;
      }

      pluginLines.push({ alias, name, description, typeName });
    }

    sections.push([sectionName, pluginLines]);
  }

  let out = `${bold("Usage:")} ${exec} [${positionalName}] [options]\n`;
  // Build options table
  for (const [sectionName, pluginLines] of sections) {
    if (pluginLines.length > 0) out += `\n${bold(sectionName + ":")}\n`;
    for (const { alias, name, description, typeName } of pluginLines) {
      out += grey(alias ? `  -${alias}, ` : "      ");
      out += `--${name}`.padEnd(maxNameLength + 4 /* len("--" + "  ") */, " ");
      out += description.padEnd(maxDescriptionLength, " ");
      out += grey(`  [${typeName}]`);
      out += "\n";
    }
  }
  return out.trimEnd();
}
