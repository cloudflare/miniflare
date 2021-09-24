import { Log, Option, OptionType, Plugin } from "@miniflare/shared";

// TODO: consider moving this to test:@miniflare/shared

export interface TestOptions {
  noneOption?: string;
  booleanOption?: boolean;
  numberOption?: number;
  stringOption?: string;
  positionalStringOption?: string;
  booleanStringOption?: boolean | string;
  arrayOptions?: string[];
  objectOptions?: Record<string, string>;
  arrayObjectOption?: [key: string, value: string][];
}

export class TestPlugin extends Plugin<TestOptions> implements TestOptions {
  @Option({ type: OptionType.NONE })
  noneOption?: string;

  @Option({
    type: OptionType.BOOLEAN,
    alias: "b",
    description: "Boolean option",
  })
  booleanOption?: boolean;

  @Option({
    type: OptionType.NUMBER,
    name: "num-option",
    alias: "n",
    description: "Number option",
  })
  numberOption?: number;

  @Option({ type: OptionType.STRING, alias: "s" })
  stringOption?: string;

  @Option({
    type: OptionType.BOOLEAN_STRING,
    description: "Boolean/string option",
  })
  booleanStringOption?: boolean | string;

  @Option({ type: OptionType.ARRAY })
  arrayOptions?: string[];

  @Option({ type: OptionType.OBJECT, alias: "o" })
  objectOptions?: Record<string, string>;

  @Option({
    type: OptionType.OBJECT,
    typeFormat: "KEY=THING",
    fromEntries: (entries) => entries,
  })
  arrayObjectOption?: [key: string, thing: string][];

  constructor(log: Log, options?: TestOptions) {
    super(log);
    Object.assign(this, options);
  }
}
