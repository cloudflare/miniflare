import { ReadableStream } from "stream/web";
import { URLSearchParams } from "url";
import { TextDecoder, TextEncoder } from "util";
import test, { Macro, ThrowsExpectation } from "ava";
import {
  Comment,
  Doctype,
  DocumentEnd,
  Element,
  HTMLRewriter,
  NoOpLog,
  Response,
  TextChunk,
} from "../../src";
import {
  HTMLRewriterModule,
  transformToArray,
} from "../../src/modules/rewriter";
import { getObjectProperties, runInWorker, wait } from "../helpers";

// TODO: (low priority) remove most of these tests, they're now in html-rewriter-wasm
// TODO: (low priority) debug why removing .serial breaks some of these tests

// region: Uint8ArrayTransformStream
const encoder = new TextEncoder();
test("transformToArray: passes through Uint8Array", (t) => {
  const array = new Uint8Array([1, 2, 3]);
  t.is(transformToArray(array), array);
});
test("transformToArray: transforms ArrayBufferView", (t) => {
  const array = new Int8Array([1, 2, 3]);
  t.deepEqual(transformToArray(array), new Uint8Array([1, 2, 3]));
});
test("transformToArray: transforms ArrayBuffer", (t) => {
  const buffer = encoder.encode("test").buffer;
  t.deepEqual(transformToArray(buffer), encoder.encode("test"));
});
test("transformToArray: transforms numeric Array", (t) => {
  t.deepEqual(transformToArray([1, 2, 3]), new Uint8Array([1, 2, 3]));
});
test("transformToArray: transforms number", (t) => {
  t.deepEqual(transformToArray(1), new Uint8Array([1]));
});
test("transformToArray: transforms string", (t) => {
  t.deepEqual(transformToArray("test"), encoder.encode("test"));
});
test("transformToArray: throws on null or undefined", (t) => {
  const expectations: ThrowsExpectation = {
    instanceOf: TypeError,
    message: "chunk must be defined",
  };
  t.throws(() => transformToArray(null), expectations);
  t.throws(() => transformToArray(undefined), expectations);
});
test("transformToArray: transforms URLSearchParams", (t) => {
  const params = new URLSearchParams({ a: "1", b: "2", c: "3" });
  t.deepEqual(transformToArray(params), encoder.encode("a=1&b=2&c=3"));
});
test("transformToArray: transforms arbitrary objects into strings", (t) => {
  t.deepEqual(transformToArray({}), encoder.encode("[object Object]"));
});
// endregion: Uint8ArrayTransformStream

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
        await wait(50);
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
    await wait(50);
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
      await wait(50);
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
          await wait(50);
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
        await wait(50);
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
        controller.enqueue(chunk);
        await wait(50);
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
  for await (const chunk of res.body) {
    chunks.push(decoder.decode(chunk));
  }
  t.true(chunks.length >= 2);
  t.is(chunks.join(""), '<html lang="en"><body><p>test</p></body></html>');
});
test("HTMLRewriter: handles empty response", async (t) => {
  // Shouldn't call BaseHTMLRewriter.write, just BaseHTMLRewriter.end
  const res = new HTMLRewriter().transform(new Response());
  t.is(await res.text(), "");
});
test("HTMLRewriter: handles empty string response", async (t) => {
  const res = new HTMLRewriter().transform(new Response(""));
  t.is(await res.text(), "");
});
test("HTMLRewriter: copies response headers", async (t) => {
  const res = new HTMLRewriter().transform(
    new Response("<p>test</p>", {
      headers: { "X-Message": "test" },
    })
  );
  t.is(res.headers.get("X-Message"), "test");
  t.is(await res.text(), "<p>test</p>");
});
// endregion: responses

test("HTMLRewriter: rethrows error thrown in handler", async (t) => {
  const res = new HTMLRewriter()
    .on("p", {
      element() {
        throw new Error("Whoops!");
      },
    })
    .transform(new Response("<p>test</p>"));
  await t.throwsAsync(res.text(), { message: "Whoops!" });
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
            await wait(50);
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
test("HTMLRewriter: handles async handlers in worker sandbox", async (t) => {
  const res = await runInWorker<string>({}, async () => {
    const sandbox = self as any;
    const res = new sandbox.HTMLRewriter()
      .on("h1", {
        // Test async functions
        async element(element: Element) {
          await new Promise((resolve) => setTimeout(resolve));
          element.after("after h1");
        },
      })
      .on("p", {
        // Test returning promise
        element(element: Element) {
          return new Promise<void>((resolve) =>
            setTimeout(() => {
              element.before("before p");
              resolve();
            })
          );
        },
      })
      .transform(new sandbox.Response("<h1>title</h1><p>body</p>"));
    return await res.text();
  });
  t.is(res, ["<h1>title</h1>", "after h1", "before p", "<p>body</p>"].join(""));
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

test("HTMLRewriter: throws error on unsupported selector", async (t) => {
  t.plan(1);
  const res = new HTMLRewriter()
    .on("p:last-child", {
      element(element) {
        element.setInnerContent("new");
      },
    })
    .transform(new Response("<p>old</p>"));
  // Cannot use t.throwsAsync here as promise rejects with string not error type
  try {
    await res.text();
  } catch (e) {
    t.is(e, "Unsupported pseudo-class or pseudo-element in selector.");
  }
});

// endregion: SELECTORS

// region: MODULE

test("HTMLRewriter: included in sandbox", async (t) => {
  const module = new HTMLRewriterModule(new NoOpLog());
  const { HTMLRewriter: SandboxHTMLRewriter } = module.buildSandbox();
  t.is(SandboxHTMLRewriter, HTMLRewriter);
});

// endregion: MODULE
