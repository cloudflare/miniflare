declare module "typeson" {
  export default class Typeson {
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    register(rules: any): this;

    parse<T>(text: string): T;
    stringify<T>(value: T): string;
  }
}
