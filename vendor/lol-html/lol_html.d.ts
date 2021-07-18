/* tslint:disable */
/* eslint-disable */
/**
*/
export class Comment {
  free(): void;
/**
* @param {string} content
* @param {any | undefined} content_type
*/
  before(content: string, content_type?: any): void;
/**
* @param {string} content
* @param {any | undefined} content_type
*/
  after(content: string, content_type?: any): void;
/**
* @param {string} content
* @param {any | undefined} content_type
*/
  replace(content: string, content_type?: any): void;
/**
*/
  remove(): void;
/**
* @returns {boolean}
*/
  readonly removed: boolean;
/**
* @returns {string}
*/
  text: string;
}
/**
*/
export class Doctype {
  free(): void;
/**
* @returns {string | undefined}
*/
  readonly name: string | undefined;
/**
* @returns {string | undefined}
*/
  readonly publicId: string | undefined;
/**
* @returns {string | undefined}
*/
  readonly systemId: string | undefined;
}
/**
*/
export class DocumentEnd {
  free(): void;
/**
* @param {string} content
* @param {any | undefined} content_type
*/
  append(content: string, content_type?: any): void;
}
/**
*/
export class Element {
  free(): void;
/**
* @param {string} content
* @param {any | undefined} content_type
*/
  before(content: string, content_type?: any): void;
/**
* @param {string} content
* @param {any | undefined} content_type
*/
  after(content: string, content_type?: any): void;
/**
* @param {string} content
* @param {any | undefined} content_type
*/
  replace(content: string, content_type?: any): void;
/**
*/
  remove(): void;
/**
* @param {string} name
* @returns {any}
*/
  getAttribute(name: string): any;
/**
* @param {string} name
* @returns {boolean}
*/
  hasAttribute(name: string): boolean;
/**
* @param {string} name
* @param {string} value
*/
  setAttribute(name: string, value: string): void;
/**
* @param {string} name
*/
  removeAttribute(name: string): void;
/**
* @param {string} content
* @param {any | undefined} content_type
*/
  prepend(content: string, content_type?: any): void;
/**
* @param {string} content
* @param {any | undefined} content_type
*/
  append(content: string, content_type?: any): void;
/**
* @param {string} content
* @param {any | undefined} content_type
*/
  setInnerContent(content: string, content_type?: any): void;
/**
*/
  removeAndKeepContent(): void;
/**
* @returns {any}
*/
  readonly attributes: any;
/**
* @returns {any}
*/
  readonly namespaceURI: any;
/**
* @returns {boolean}
*/
  readonly removed: boolean;
/**
* @returns {string}
*/
  tagName: string;
}
/**
*/
export class HTMLRewriter {
  free(): void;
/**
* @param {Function} output_sink
*/
  constructor(output_sink: Function);
/**
* @param {string} selector
* @param {any} handlers
*/
  on(selector: string, handlers: any): void;
/**
* @param {any} handlers
*/
  onDocument(handlers: any): void;
// PATCH: switched to Promise<void> return types
/**
* @param {Uint8Array} chunk
*/
  write(chunk: Uint8Array): Promise<void>;
/**
*/
  end(): Promise<void>;
}
/**
*/
export class TextChunk {
  free(): void;
/**
* @param {string} content
* @param {any | undefined} content_type
*/
  before(content: string, content_type?: any): void;
/**
* @param {string} content
* @param {any | undefined} content_type
*/
  after(content: string, content_type?: any): void;
/**
* @param {string} content
* @param {any | undefined} content_type
*/
  replace(content: string, content_type?: any): void;
/**
*/
  remove(): void;
/**
* @returns {boolean}
*/
  readonly lastInTextNode: boolean;
/**
* @returns {boolean}
*/
  readonly removed: boolean;
/**
* @returns {string}
*/
  readonly text: string;
}
// PATCH: added export
export function registerPromise(promise: Promise<any>): number;