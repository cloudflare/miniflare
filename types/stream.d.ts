// Types for experimental stream/web not currently in @types/node
declare module "stream/web" {
  // TODO: (low priority) try export these from typescript's built-in lib
  export * from "web-streams-polyfill/ponyfill/es2018";
}
