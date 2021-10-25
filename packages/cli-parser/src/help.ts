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

export function wrapLines(text: string, length: number): string[] {
  const lines = [text];
  let lastLine: string;
  while ((lastLine = lines[lines.length - 1]).length > length) {
    const spaceIndex = lastLine.lastIndexOf(" ", length);
    if (spaceIndex === -1) break; // Abort if we can't wrap
    lines[lines.length - 1] = lastLine.substring(0, spaceIndex);
    lines.push(lastLine.substring(spaceIndex + 1));
  }
  return lines;
}

export function buildHelp<Plugins extends PluginSignatures>(
  plugins: Plugins,
  exec: string,
  columns = process.stdout.columns
): string {
  // Name of single positional argument if any
  let positionalName = "";
  // Max lengths of name, description and type name fields for formatting table
  let maxNameLength = 0;
  let maxDescriptionLength = 0;
  let maxTypeLength = 0;
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
      const { type, typeFormat, alias, description = "", negatable } = meta;
      // Ignore API-only options (e.g. string script)
      if (type === OptionType.NONE) continue;

      let name = argName(key, meta);
      if (negatable) name = `(no-)${name}`;
      if (type === OptionType.STRING_POSITIONAL) {
        positionalName = name;
        // Positional arguments shouldn't appear in options list
        continue;
      }

      // Convert OptionType.ARRAY -> array
      let typeName = OptionType[type].toLowerCase();
      if (type === OptionType.BOOLEAN_STRING) typeName = "boolean/string";
      if (type === OptionType.OBJECT) {
        typeName = `array:${typeFormat ?? "KEY=VALUE"}`;
      }

      if (name.length > maxNameLength) {
        maxNameLength = name.length;
      }
      if (description.length > maxDescriptionLength) {
        maxDescriptionLength = description.length;
      }
      if (typeName.length > maxTypeLength) {
        maxTypeLength = typeName.length;
      }

      pluginLines.push({ alias, name, description, typeName });
    }

    sections.push([sectionName, pluginLines]);
  }

  const leftPaddingLength = maxNameLength + 8; /* len(" -a, -- ") */
  const leftPadding = "".padEnd(leftPaddingLength, " ");
  // Clamp columns to the maximum line length
  columns = Math.min(
    leftPaddingLength + maxDescriptionLength + maxTypeLength + 3,
    columns
  );

  let out = `${bold("Usage:")} ${exec} [${positionalName}] [options]\n`;
  // Build options table
  for (const [sectionName, pluginLines] of sections) {
    if (pluginLines.length > 0) out += `\n${bold(sectionName + ":")}\n`;
    for (const { alias, name, description, typeName } of pluginLines) {
      out += grey(alias ? ` -${alias}, ` : "     ");
      out += `--${name}`.padEnd(maxNameLength + 3 /* len("-- ") */, " ");

      // Calculate maximum line length of description and wrap lines to that
      const lineLength =
        columns - (leftPaddingLength + typeName.length + 3); /* len(" []") */
      const lines = wrapLines(description, lineLength);

      // Pad first line to max line length so typeName aligned correctly
      out += lines[0].padEnd(lineLength, " ");
      out += grey(` [${typeName}]`);
      for (let i = 1; i < lines.length; i++) {
        out += `\n${leftPadding}${lines[i]}`;
      }
      out += "\n";
    }
  }
  return out.trimEnd();
}
