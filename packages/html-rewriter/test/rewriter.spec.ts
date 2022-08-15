import assert from "assert";
import { ReadableStream } from "stream/web";
import { setTimeout } from "timers/promises";
import { TextDecoder, TextEncoder } from "util";
import { Response } from "@miniflare/core";
import { HTMLRewriter, HTMLRewriterPlugin } from "@miniflare/html-rewriter";
import {
  getObjectProperties,
  useMiniflareWithHandler,
} from "@miniflare/shared-test";
import test, { ExecutionContext, Macro } from "ava";
import {
  HTMLRewriter as BaseHTMLRewriter,
  Comment,
  Doctype,
  DocumentEnd,
  Element,
  TextChunk,
} from "html-rewriter-wasm";

// TODO (someday): debug why removing .serial breaks some of these async tests

const encoder = new TextEncoder();

// Must be run in serial tests
function recordFree(t: ExecutionContext): { freed: boolean } {
  const result = { freed: false };
  const originalFree = BaseHTMLRewriter.prototype.free;
  BaseHTMLRewriter.prototype.free = function () {
    result.freed = true;
    originalFree.bind(this)();
  };
  t.teardown(() => {
    BaseHTMLRewriter.prototype.free = originalFree;
  });
  return result;
}

// region: ELEMENT HANDLERS

const mutationsMacro: Macro<
  [
    (
      rw: HTMLRewriter,
      handler: (token: Element | TextChunk | Comment) => void
    ) => HTMLRewriter,
    string,
    {
      beforeAfter: string;
      replace: string;
      replaceHtml: string;
      remove: string;
    }
  ]
> = async (t, func, input, expected) => {
  // In all these tests, only process text chunks containing text. All test
  // inputs for text handlers will be single characters, so we'll only process
  // text nodes once.

  // before/after
  let res = func(new HTMLRewriter(), (token) => {
    if ("text" in token && !token.text) return;
    token.before("<span>before</span>");
    token.before("<span>before html</span>", { html: true });
    token.after("<span>after</span>");
    token.after("<span>after html</span>", { html: true });
  }).transform(new Response(input));
  t.is(await res.text(), expected.beforeAfter);

  // replace
  res = func(new HTMLRewriter(), (token) => {
    if ("text" in token && !token.text) return;
    token.replace("<span>replace</span>");
  }).transform(new Response(input));
  t.is(await res.text(), expected.replace);
  res = func(new HTMLRewriter(), (token) => {
    if ("text" in token && !token.text) return;
    token.replace("<span>replace</span>", { html: true });
  }).transform(new Response(input));
  t.is(await res.text(), expected.replaceHtml);

  // remove
  res = func(new HTMLRewriter(), (token) => {
    if ("text" in token && !token.text) return;
    t.false(token.removed);
    token.remove();
    t.true(token.removed);
  }).transform(new Response(input));
  t.is(await res.text(), expected.remove);
};

// region: element
const elementMutationsInput = "<p>test</p>";
const elementMutationsExpected = {
  beforeAfter: [
    "&lt;span&gt;before&lt;/span&gt;",
    "<span>before html</span>",
    "<p>",
    "test",
    "</p>",
    "<span>after html</span>",
    "&lt;span&gt;after&lt;/span&gt;",
  ].join(""),
  replace: "&lt;span&gt;replace&lt;/span&gt;",
  replaceHtml: "<span>replace</span>",
  remove: "",
};

test("HTMLRewriter: handles element properties", async (t) => {
  t.plan(5);
  const res = new HTMLRewriter()
    .on("p", {
      element(element) {
        t.is(element.tagName, "p");
        element.tagName = "h1";
        t.deepEqual([...element.attributes], [["class", "red"]]);
        t.false(element.removed);
        t.is(element.namespaceURI, "http://www.w3.org/1999/xhtml");
      },
    })
    .transform(new Response('<p class="red">test</p>'));
  t.is(await res.text(), '<h1 class="red">test</h1>');
});
test("HTMLRewriter: handles element attribute methods", async (t) => {
  t.plan(5);
  const res = new HTMLRewriter()
    .on("p", {
      element(element) {
        t.is(element.getAttribute("class"), "red");
        t.is(element.getAttribute("id"), null);
        t.true(element.hasAttribute("class"));
        t.false(element.hasAttribute("id"));
        element.setAttribute("id", "header");
        element.removeAttribute("class");
      },
    })
    .transform(new Response('<p class="red">test</p>'));
  t.is(await res.text(), '<p id="header">test</p>');
});
test(
  "HTMLRewriter: handles element mutations",
  mutationsMacro,
  (rw, element) => rw.on("p", { element }),
  elementMutationsInput,
  elementMutationsExpected
);
test("HTMLRewriter: handles element specific mutations", async (t) => {
  // prepend/append
  let res = new HTMLRewriter()
    .on("p", {
      element(element) {
        element.prepend("<span>prepend</span>");
        element.prepend("<span>prepend html</span>", { html: true });
        element.append("<span>append</span>");
        element.append("<span>append html</span>", { html: true });
      },
    })
    .transform(new Response("<p>test</p>"));
  t.is(
    await res.text(),
    [
      "<p>",
      "<span>prepend html</span>",
      "&lt;span&gt;prepend&lt;/span&gt;",
      "test",
      "&lt;span&gt;append&lt;/span&gt;",
      "<span>append html</span>",
      "</p>",
    ].join("")
  );

  // setInnerContent
  res = new HTMLRewriter()
    .on("p", {
      element(element) {
        element.setInnerContent("<span>replace</span>");
      },
    })
    .transform(new Response("<p>test</p>"));
  t.is(await res.text(), "<p>&lt;span&gt;replace&lt;/span&gt;</p>");
  res = new HTMLRewriter()
    .on("p", {
      element(element) {
        element.setInnerContent("<span>replace</span>", { html: true });
      },
    })
    .transform(new Response("<p>test</p>"));
  t.is(await res.text(), "<p><span>replace</span></p>");

  // removeAndKeepContent
  res = new HTMLRewriter()
    .on("p", {
      element(element) {
        element.removeAndKeepContent();
      },
    })
    .transform(new Response("<p>test</p>"));
  t.is(await res.text(), "test");
});
test.serial("HTMLRewriter: handles element async handler", async (t) => {
  const res = new HTMLRewriter()
    .on("p", {
      async element(element) {
        await setTimeout(50);
        element.setInnerContent("new");
      },
    })
    .transform(new Response("<p>test</p>"));
  t.is(await res.text(), "<p>new</p>");
});
test("HTMLRewriter: handles element class handler", async (t) => {
  class Handler {
    constructor(private content: string) {}
    // noinspection JSUnusedGlobalSymbols
    element(element: Element) {
      element.setInnerContent(this.content);
    }
  }
  const res = new HTMLRewriter()
    .on("p", new Handler("new"))
    .transform(new Response("<p>test</p>"));
  t.is(await res.text(), "<p>new</p>");
});

test("HTMLRewriter: handles end tag properties", async (t) => {
  const res = new HTMLRewriter()
    .on("p", {
      element(element) {
        element.onEndTag(function (end) {
          t.is(this, element);
          t.is(end.name, "p");
          end.name = "h1";
        });
      },
    })
    .transform(new Response("<p>test</p>"));
  t.is(await res.text(), "<p>test</h1>");
});
test("HTMLRewriter: handles end tag mutations", async (t) => {
  const input = "<p>test</p>";
  const beforeAfterExpected = [
    "<p>",
    "test",
    "&lt;span&gt;before&lt;/span&gt;",
    "<span>before html</span>",
    "</p>",
    "<span>after html</span>",
    "&lt;span&gt;after&lt;/span&gt;",
  ].join("");
  const removeExpected = "<p>test";

  // before/after
  let res = new HTMLRewriter()
    .on("p", {
      element(element) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const that = this;
        element.onEndTag((end) => {
          t.is(this, that);
          end.before("<span>before</span>");
          end.before("<span>before html</span>", { html: true });
          end.after("<span>after</span>");
          end.after("<span>after html</span>", { html: true });
        });
      },
    })
    .transform(new Response(input));
  t.is(await res.text(), beforeAfterExpected);

  // remove
  res = new HTMLRewriter()
    .on("p", {
      element(element) {
        element.onEndTag((end) => {
          end.remove();
        });
      },
    })
    .transform(new Response(input));
  t.is(await res.text(), removeExpected);
});
test.serial("HTMLRewriter: handles end tag async handler", async (t) => {
  const res = new HTMLRewriter()
    .on("p", {
      element(element) {
        element.onEndTag(async (end) => {
          await setTimeout(50);
          end.before("!");
        });
      },
    })
    .transform(new Response("<p>test</p>"));
  t.is(await res.text(), "<p>test!</p>");
});
// endregion: element

// region: comments
const commentsMutationsInput = "<p><!--test--></p>";
const commentsMutationsExpected = {
  beforeAfter: [
    "<p>",
    "&lt;span&gt;before&lt;/span&gt;",
    "<span>before html</span>",
    "<!--test-->",
    "<span>after html</span>",
    "&lt;span&gt;after&lt;/span&gt;",
    "</p>",
  ].join(""),
  replace: "<p>&lt;span&gt;replace&lt;/span&gt;</p>",
  replaceHtml: "<p><span>replace</span></p>",
  remove: "<p></p>",
};

const commentPropertiesMacro: Macro<
  [(rw: HTMLRewriter, comments: (comment: Comment) => void) => HTMLRewriter]
> = async (t, func) => {
  t.plan(3);
  const res = func(new HTMLRewriter(), (comment) => {
    t.false(comment.removed);
    t.is(comment.text, "test");
    comment.text = "new";
  }).transform(new Response("<p><!--test--></p>"));
  t.is(await res.text(), "<p><!--new--></p>");
};
test(
  "HTMLRewriter: handles comment properties",
  commentPropertiesMacro,
  (rw, comments) => rw.on("p", { comments })
);
test(
  "HTMLRewriter: handles comment mutations",
  mutationsMacro,
  (rw, comments) => rw.on("p", { comments }),
  commentsMutationsInput,
  commentsMutationsExpected
);
const commentAsyncHandlerMacro: Macro<
  [(rw: HTMLRewriter, comments: (c: Comment) => Promise<void>) => HTMLRewriter]
> = async (t, func) => {
  const res = func(new HTMLRewriter(), async (comment) => {
    await setTimeout(50);
    comment.text = "new";
  }).transform(new Response("<p><!--test--></p>"));
  t.is(await res.text(), "<p><!--new--></p>");
};
test.serial(
  "HTMLRewriter: handles comment async handler",
  commentAsyncHandlerMacro,
  (rw, comments) => rw.on("p", { comments })
);
const commentClassHandlerMacro: Macro<
  [(rw: HTMLRewriter, h: { comments: (c: Comment) => void }) => HTMLRewriter]
> = async (t, func) => {
  class Handler {
    constructor(private content: string) {}
    // noinspection JSUnusedGlobalSymbols
    comments(comment: Comment) {
      comment.text = this.content;
    }
  }
  const res = func(new HTMLRewriter(), new Handler("new")).transform(
    new Response("<p><!--test--></p>")
  );
  t.is(await res.text(), "<p><!--new--></p>");
};
test(
  "HTMLRewriter: handles comment class handler",
  commentClassHandlerMacro,
  (rw, handler) => rw.on("p", handler)
);
// endregion: comments

// region: text
const textMutationsInput = "<p>t</p>"; // Single character will be single chunk
const textMutationsExpected = {
  beforeAfter: [
    "<p>",
    "&lt;span&gt;before&lt;/span&gt;",
    "<span>before html</span>",
    "t",
    "<span>after html</span>",
    "&lt;span&gt;after&lt;/span&gt;",
    "</p>",
  ].join(""),
  replace: "<p>&lt;span&gt;replace&lt;/span&gt;</p>",
  replaceHtml: "<p><span>replace</span></p>",
  remove: "<p></p>",
};

const textPropertiesMacro: Macro<
  [(rw: HTMLRewriter, text: (text: TextChunk) => void) => HTMLRewriter]
> = async (t, func) => {
  t.plan(6);
  const res = func(new HTMLRewriter(), (text) => {
    // This handler should get called twice, once with lastInTextNode true
    t.false(text.removed);
    if (text.lastInTextNode) {
      t.pass();
      t.is(text.text, "");
    } else {
      t.is(text.text, "t");
    }
  }).transform(new Response("<p>t</p>"));
  t.is(await res.text(), "<p>t</p>");
};
test("HTMLRewriter: handles text properties", textPropertiesMacro, (rw, text) =>
  rw.on("p", { text })
);
test(
  "HTMLRewriter: handles text mutations",
  mutationsMacro,
  (rw, text) => rw.on("p", { text }),
  textMutationsInput,
  textMutationsExpected
);
const textAsyncHandlerMacro: Macro<
  [(rw: HTMLRewriter, text: (t: TextChunk) => Promise<void>) => HTMLRewriter]
> = async (t, func) => {
  const res = func(new HTMLRewriter(), async (text) => {
    if (text.text === "t") {
      await setTimeout(50);
      text.after(" new");
    }
  }).transform(new Response("<p>t</p>"));
  t.is(await res.text(), "<p>t new</p>");
};
test.serial(
  "HTMLRewriter: handles text async handler",
  textAsyncHandlerMacro,
  (rw, text) => rw.on("p", { text })
);
const textClassHandlerMacro: Macro<
  [
    (
      rw: HTMLRewriter,
      handler: { text: (text: TextChunk) => void }
    ) => HTMLRewriter
  ]
> = async (t, func) => {
  class Handler {
    constructor(private content: string) {}
    text(text: TextChunk) {
      if (text.text === "t") text.after(this.content);
    }
  }
  const res = func(new HTMLRewriter(), new Handler(" new")).transform(
    new Response("<p>t</p>")
  );
  t.is(await res.text(), "<p>t new</p>");
};
test(
  "HTMLRewriter: handles text class handler",
  textClassHandlerMacro,
  (rw, handler) => rw.on("p", handler)
);
// endregion: text

test("HTMLRewriter: handles multiple element handlers", async (t) => {
  const res = new HTMLRewriter()
    .on("h1", {
      element(element) {
        element.setInnerContent("new h1");
      },
    })
    .on("h2", {
      element(element) {
        element.setInnerContent("new h2");
      },
    })
    .on("p", {
      element(element) {
        element.setInnerContent("new p");
      },
    })
    .transform(new Response("<h1>old h1</h1><h2>old h2</h2><p>old p</p>"));
  t.is(await res.text(), "<h1>new h1</h1><h2>new h2</h2><p>new p</p>");
});

// endregion: ELEMENT HANDLERS

// region: DOCUMENT HANDLERS

// region: doctype
const doctypeInput =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd"><html lang="en"></html>';
test("HTMLRewriter: handles document doctype properties", async (t) => {
  t.plan(4);
  const res = new HTMLRewriter()
    .onDocument({
      doctype(doctype) {
        t.is(doctype.name, "html");
        t.is(doctype.publicId, "-//W3C//DTD HTML 4.01//EN");
        t.is(doctype.systemId, "http://www.w3.org/TR/html4/strict.dtd");
      },
    })
    .transform(new Response(doctypeInput));
  t.is(await res.text(), doctypeInput);
});
test.serial(
  "HTMLRewriter: handles document doctype async handler",
  async (t) => {
    const res = new HTMLRewriter()
      .onDocument({
        async doctype(doctype) {
          await setTimeout(50);
          t.is(doctype.name, "html");
        },
      })
      .transform(new Response(doctypeInput));
    t.is(await res.text(), doctypeInput);
  }
);
test("HTMLRewriter: handles document doctype class handler", async (t) => {
  class Handler {
    constructor(private content: string) {}
    // noinspection JSUnusedGlobalSymbols
    doctype(doctype: Doctype) {
      t.is(doctype.name, "html");
      t.is(this.content, "new");
    }
  }
  const res = new HTMLRewriter()
    .onDocument(new Handler("new"))
    .transform(new Response(doctypeInput));
  t.is(await res.text(), doctypeInput);
});
// endregion: doctype

// region: comments
test(
  "HTMLRewriter: handles document comment properties",
  commentPropertiesMacro,
  (rw, comments) => rw.onDocument({ comments })
);
test(
  "HTMLRewriter: handles document comment mutations",
  mutationsMacro,
  (rw, comments) => rw.onDocument({ comments }),
  commentsMutationsInput,
  commentsMutationsExpected
);
test.serial(
  "HTMLRewriter: handles document comment async handler",
  commentAsyncHandlerMacro,
  (rw, comments) => rw.onDocument({ comments })
);
test(
  "HTMLRewriter: handles document comment class handler",
  commentClassHandlerMacro,
  (rw, handler) => rw.onDocument(handler)
);
// endregion: comments

// region: text
test(
  "HTMLRewriter: handles document text properties",
  textPropertiesMacro,
  (rw, text) => rw.onDocument({ text })
);
test(
  "HTMLRewriter: handles document text mutations",
  mutationsMacro,
  (rw, text) => rw.onDocument({ text }),
  textMutationsInput,
  textMutationsExpected
);
test.serial(
  "HTMLRewriter: handles document text async handler",
  textAsyncHandlerMacro,
  (rw, text) => rw.onDocument({ text })
);
test(
  "HTMLRewriter: handles document text class handler",
  textClassHandlerMacro,
  (rw, handler) => rw.onDocument(handler)
);
// endregion: text

// region: end
test("HTMLRewriter: handles document end specific mutations", async (t) => {
  // append
  const res = new HTMLRewriter()
    .onDocument({
      end(end) {
        end.append("<span>append</span>");
        end.append("<span>append html</span>", { html: true });
      },
    })
    .transform(new Response("<p>test</p>"));
  t.is(
    await res.text(),
    [
      "<p>",
      "test",
      "</p>",
      "&lt;span&gt;append&lt;/span&gt;",
      "<span>append html</span>",
    ].join("")
  );
});
test.serial("HTMLRewriter: handles document end async handler", async (t) => {
  const res = new HTMLRewriter()
    .onDocument({
      async end(end) {
        await setTimeout(50);
        end.append("<span>append html</span>", { html: true });
      },
    })
    .transform(new Response("<p>test</p>"));
  t.is(await res.text(), "<p>test</p><span>append html</span>");
});
test("HTMLRewriter: handles document end class handler", async (t) => {
  class Handler {
    constructor(private content: string) {}
    // noinspection JSUnusedGlobalSymbols
    end(end: DocumentEnd) {
      end.append(this.content, { html: true });
    }
  }
  const res = new HTMLRewriter()
    .onDocument(new Handler("<span>append html</span>"))
    .transform(new Response("<p>test</p>"));
  t.is(await res.text(), "<p>test</p><span>append html</span>");
});
// endregion: end

// endregion: DOCUMENT HANDLERS

// region: HTMLRewriter MISC

// region: responses
test("HTMLRewriter: handles streaming responses", async (t) => {
  const inputStream = new ReadableStream({
    async start(controller) {
      const chunks = [
        '<html lang="en">',
        "<bo",
        "dy>",
        "<p>",
        "te",
        "st",
        "</p></body>",
        "</html>",
      ];
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
        await setTimeout(50);
      }
      controller.close();
    },
  });

  t.plan(8); // 6 for text handler + 2 at the end
  const expectedTextChunks = ["te", "st", ""];
  const res = new HTMLRewriter()
    .on("p", {
      text(text) {
        t.is(text.text, expectedTextChunks.shift());
        t.is(text.lastInTextNode, text.text === "");
      },
    })
    .transform(new Response(inputStream));

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  assert(res.body);
  for await (const chunk of res.body) {
    chunks.push(decoder.decode(chunk));
  }
  t.true(chunks.length >= 2);
  t.is(chunks.join(""), '<html lang="en"><body><p>test</p></body></html>');
});
test.serial(
  "HTMLRewriter: handles ArrayBuffer and ArrayBufferView chunks",
  async (t) => {
    t.plan(3);
    const inputStream = new ReadableStream({
      start(controller) {
        const buffer = encoder.encode("<p>").buffer;
        let array = encoder.encode("test");
        const view1 = new Uint16Array(
          array.buffer,
          array.byteOffset,
          array.byteLength / Uint16Array.BYTES_PER_ELEMENT
        );
        array = encoder.encode("</p>");
        const view2 = new DataView(
          array.buffer,
          array.byteOffset,
          array.byteLength
        );
        controller.enqueue(buffer);
        controller.enqueue(view1);
        controller.enqueue(view2);
        controller.close();
      },
    });
    const freed = recordFree(t);
    const res = new HTMLRewriter()
      .on("p", {
        text(text) {
          if (text.text) t.is(text.text, "test");
        },
      })
      .transform(new Response(inputStream));
    t.is(await res.text(), "<p>test</p>");
    // TODO: try remove this, we shouldn't need it
    await setTimeout();
    t.true(freed.freed);
  }
);
test.serial("HTMLRewriter: throws on string chunks", async (t) => {
  const freed = recordFree(t);
  const inputStream = new ReadableStream({
    start(controller) {
      controller.enqueue("I'm a string");
      controller.close();
    },
  });
  const res = new HTMLRewriter().transform(new Response(inputStream));
  await t.throwsAsync(res.text(), {
    instanceOf: TypeError,
    message:
      "This TransformStream is being used as a byte stream, " +
      "but received a string on its writable side. " +
      "If you wish to write a string, you'll probably want to " +
      "explicitly UTF-8-encode it with TextEncoder.",
  });
  t.true(freed.freed);
});
test.serial(
  "HTMLRewriter: throws on non-ArrayBuffer/ArrayBufferView chunks",
  async (t) => {
    const freed = recordFree(t);
    const inputStream = new ReadableStream({
      start(controller) {
        controller.enqueue(42);
        controller.close();
      },
    });
    const res = new HTMLRewriter().transform(new Response(inputStream));
    await t.throwsAsync(res.text(), {
      instanceOf: TypeError,
      message:
        "This TransformStream is being used as a byte stream, " +
        "but received an object of non-ArrayBuffer/ArrayBufferView " +
        "type on its writable side.",
    });
    t.true(freed.freed);
  }
);
test("HTMLRewriter: handles empty response", async (t) => {
  // Shouldn't call BaseHTMLRewriter.write, just BaseHTMLRewriter.end
  const res = new HTMLRewriter()
    .onDocument({
      end(end) {
        end.append("end");
      },
    })
    .transform(new Response());
  // Workers don't run the end() handler on null responses
  t.is(await res.text(), "");
});
test("HTMLRewriter: handles empty string response", async (t) => {
  const res = new HTMLRewriter()
    .onDocument({
      end(end) {
        end.append("end");
      },
    })
    .transform(new Response(""));
  t.is(await res.text(), "end");
});
test("HTNLRewriter: doesn't transform response until needed", async (t) => {
  const chunks: string[] = [];
  const res = new HTMLRewriter()
    .on("p", {
      text(text) {
        if (text.text) chunks.push(text.text);
      },
    })
    .transform(new Response("<p>1</p><p>2</p><p>3</p>"));
  await setTimeout(50);
  t.deepEqual(chunks, []);
  await res.arrayBuffer();
  t.deepEqual(chunks, ["1", "2", "3"]);
});
test("HTMLRewriter: copies response status and headers", async (t) => {
  const res = new HTMLRewriter().transform(
    new Response("<p>test</p>", {
      status: 404,
      headers: { "X-Message": "test" },
    })
  );
  t.is(res.headers.get("X-Message"), "test");
  t.is(res.status, 404);
  t.is(await res.text(), "<p>test</p>");
});
// endregion: responses

test.serial("HTMLRewriter: rethrows error thrown in handler", async (t) => {
  const freed = recordFree(t);
  const res = new HTMLRewriter()
    .on("p", {
      element() {
        throw new Error("Whoops!");
      },
    })
    .transform(new Response("<p>test</p>"));
  await t.throwsAsync(res.text(), { message: "Whoops!" });
  await setTimeout();
  t.true(freed.freed);
});
test.serial("HTMLRewriter: rethrows error thrown in end handler", async (t) => {
  const freed = recordFree(t);
  const res = new HTMLRewriter()
    .onDocument({
      end() {
        throw new Error("Whoops!");
      },
    })
    .transform(new Response("<p>test</p>"));
  await t.throwsAsync(res.text(), { message: "Whoops!" });
  await setTimeout();
  t.true(freed.freed);
});

test("HTMLRewriter: can use same rewriter multiple times", async (t) => {
  const rw = new HTMLRewriter().on("p", {
    element(element) {
      element.setInnerContent("new");
    },
  });
  for (let i = 0; i < 3; i++) {
    const res = rw.transform(new Response(`<p>old ${i}</p>`));
    t.is(await res.text(), "<p>new</p>");
  }
});

test("HTMLRewriter: handles concurrent rewriters with sync handlers", async (t) => {
  const rewriter = (i: number) =>
    new HTMLRewriter()
      .on("p", {
        element(element) {
          element.setInnerContent(`new ${i}`);
        },
      })
      .transform(new Response(`<p>old ${i}</p>`));

  const res1 = rewriter(1);
  const res2 = rewriter(2);
  t.is(await res1.text(), "<p>new 1</p>");
  t.is(await res2.text(), "<p>new 2</p>");

  const res3 = rewriter(3);
  const res4 = rewriter(4);
  const texts = await Promise.all([res3.text(), res4.text()]);
  t.deepEqual(texts, ["<p>new 3</p>", "<p>new 4</p>"]);
});
test.serial(
  "HTMLRewriter: handles concurrent rewriters with async handlers",
  async (t) => {
    // Note this test requires the "safe" HTMLRewriter, see comments in
    // src/modules/rewriter.ts for more details
    const rewriter = (i: number) =>
      new HTMLRewriter()
        .on("p", {
          async element(element) {
            await setTimeout(50);
            element.setInnerContent(`new ${i}`);
          },
        })
        .transform(new Response(`<p>old ${i}</p>`));

    const res1 = rewriter(1);
    const res2 = rewriter(2);
    t.is(await res1.text(), "<p>new 1</p>");
    t.is(await res2.text(), "<p>new 2</p>");

    const res3 = rewriter(3);
    const res4 = rewriter(4);
    const texts = await Promise.all([res3.text(), res4.text()]);
    t.deepEqual(texts, ["<p>new 3</p>", "<p>new 4</p>"]);
  }
);
test.serial("HTMLRewriter: handles async handlers in sandbox", async (t) => {
  const mf = useMiniflareWithHandler({ HTMLRewriterPlugin }, {}, (globals) => {
    return new globals.HTMLRewriter()
      .on("p", {
        async element(element: Element) {
          await new Promise((resolve) => globals.setTimeout(resolve, 50));
          element.append(" append");
        },
      })
      .transform(new globals.Response("<p>test</p>"));
  });
  const res = await mf.dispatchFetch("http://localhost");
  t.is(await res.text(), "<p>test append</p>");
});
test("HTMLRewriter: strips Content-Length header from transformed response", async (t) => {
  const res = new HTMLRewriter()
    .on("p", {
      element(element) {
        element.setInnerContent("very long new text");
      },
    })
    .transform(
      new Response(`<p>old</p>`, {
        headers: {
          "Content-Type": "text/html",
          "Content-Length": "10",
        },
      })
    );
  t.is(res.headers.get("Content-Type"), "text/html");
  t.false(res.headers.has("Content-Length"));
  t.is(await res.text(), "<p>very long new text</p>");
});
test("HTMLRewriter: hides implementation details", (t) => {
  const rewriter = new HTMLRewriter();
  t.deepEqual(getObjectProperties(rewriter), ["on", "onDocument", "transform"]);
});

// endregion: HTMLRewriter MISC

// region: SELECTORS

const selectorMacro: Macro<
  [selector: string, input: string, expected: string]
> = async (t, selector, input, expected) => {
  const res = new HTMLRewriter()
    .on(selector, {
      element(element) {
        element.setInnerContent("new");
      },
    })
    .transform(new Response(input));
  t.is(await res.text(), expected);
};
selectorMacro.title = (providedTitle) =>
  `HTMLRewriter: handles ${providedTitle} selector`;

test("*", selectorMacro, "*", "<h1>1</h1><p>2</p>", "<h1>new</h1><p>new</p>");
test("E", selectorMacro, "p", "<h1>1</h1><p>2</p>", "<h1>1</h1><p>new</p>");
test(
  "E:nth-child(n)",
  selectorMacro,
  "p:nth-child(2)",
  "<div><p>1</p><p>2</p><p>3</p></div>",
  "<div><p>1</p><p>new</p><p>3</p></div>"
);
test(
  "E:first-child",
  selectorMacro,
  "p:first-child",
  "<div><p>1</p><p>2</p><p>3</p></div>",
  "<div><p>new</p><p>2</p><p>3</p></div>"
);
test(
  "E:nth-of-type(n)",
  selectorMacro,
  "p:nth-of-type(2)",
  "<div><p>1</p><h1>2</h1><p>3</p><h1>4</h1><p>5</p></div>",
  "<div><p>1</p><h1>2</h1><p>new</p><h1>4</h1><p>5</p></div>"
);
test(
  "E:first-of-type",
  selectorMacro,
  "p:first-of-type",
  "<div><h1>1</h1><p>2</p><p>3</p></div>",
  "<div><h1>1</h1><p>new</p><p>3</p></div>"
);
test(
  "E:not(s)",
  selectorMacro,
  "p:not(:first-child)",
  "<div><p>1</p><p>2</p><p>3</p></div>",
  "<div><p>1</p><p>new</p><p>new</p></div>"
);
test(
  "E.class",
  selectorMacro,
  "p.red",
  '<p class="red">1</p><p>2</p>',
  '<p class="red">new</p><p>2</p>'
);
test(
  "E#id",
  selectorMacro,
  "h1#header",
  '<h1 id="header">1</h1><h1>2</h1>',
  '<h1 id="header">new</h1><h1>2</h1>'
);
test(
  "E[attr]",
  selectorMacro,
  "p[data-test]",
  "<p data-test>1</p><p>2</p>",
  "<p data-test>new</p><p>2</p>"
);
test(
  'E[attr="value"]',
  selectorMacro,
  'p[data-test="one"]',
  '<p data-test="one">1</p><p data-test="two">2</p>',
  '<p data-test="one">new</p><p data-test="two">2</p>'
);
test(
  'E[attr="value" i]',
  selectorMacro,
  'p[data-test="one" i]',
  '<p data-test="one">1</p><p data-test="OnE">2</p><p data-test="two">3</p>',
  '<p data-test="one">new</p><p data-test="OnE">new</p><p data-test="two">3</p>'
);
test(
  'E[attr="value" s]',
  selectorMacro,
  'p[data-test="one" s]',
  '<p data-test="one">1</p><p data-test="OnE">2</p><p data-test="two">3</p>',
  '<p data-test="one">new</p><p data-test="OnE">2</p><p data-test="two">3</p>'
);
test(
  'E[attr~="value"]',
  selectorMacro,
  'p[data-test~="two"]',
  '<p data-test="one two three">1</p><p data-test="one two">2</p><p data-test="one">3</p>',
  '<p data-test="one two three">new</p><p data-test="one two">new</p><p data-test="one">3</p>'
);
test(
  'E[attr^="value"]',
  selectorMacro,
  'p[data-test^="a"]',
  '<p data-test="a1">1</p><p data-test="a2">2</p><p data-test="b1">3</p>',
  '<p data-test="a1">new</p><p data-test="a2">new</p><p data-test="b1">3</p>'
);
test(
  'E[attr$="value"]',
  selectorMacro,
  'p[data-test$="1"]',
  '<p data-test="a1">1</p><p data-test="a2">2</p><p data-test="b1">3</p>',
  '<p data-test="a1">new</p><p data-test="a2">2</p><p data-test="b1">new</p>'
);
test(
  'E[attr*="value"]',
  selectorMacro,
  'p[data-test*="b"]',
  '<p data-test="abc">1</p><p data-test="ab">2</p><p data-test="a">3</p>',
  '<p data-test="abc">new</p><p data-test="ab">new</p><p data-test="a">3</p>'
);
test(
  'E[attr|="value"]',
  selectorMacro,
  'p[data-test|="a"]',
  '<p data-test="a">1</p><p data-test="a-1">2</p><p data-test="a2">3</p>',
  '<p data-test="a">new</p><p data-test="a-1">new</p><p data-test="a2">3</p>'
);
test(
  "E F",
  selectorMacro,
  "div span",
  "<div><h1><span>1</span></h1><span>2</span><b>3</b></div>",
  "<div><h1><span>new</span></h1><span>new</span><b>3</b></div>"
);
test(
  "E > F",
  selectorMacro,
  "div > span",
  "<div><h1><span>1</span></h1><span>2</span><b>3</b></div>",
  "<div><h1><span>1</span></h1><span>new</span><b>3</b></div>"
);

test.serial("HTMLRewriter: throws error on unsupported selector", async (t) => {
  const freed = recordFree(t);
  const res = new HTMLRewriter()
    .on("p:last-child", {
      element(element) {
        element.setInnerContent("new");
      },
    })
    .transform(new Response("<p>old</p>"));
  await t.throwsAsync(res.text(), {
    instanceOf: TypeError,
    message:
      "Parser error: Unsupported pseudo-class or pseudo-element in selector.",
  });
  t.true(freed.freed);
});

// endregion: SELECTORS
