import { OptionMetadata, OptionType, kebabCase } from "@miniflare/shared";

export function argName(key: string, { name, type }: OptionMetadata): string {
  name ??= kebabCase(key);
  if (
    (type === OptionType.ARRAY || type === OptionType.OBJECT) &&
    name.endsWith("s")
  ) {
    name = name.substring(0, name.length - 1);
  }
  return name;
}
