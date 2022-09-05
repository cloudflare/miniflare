import { expect, test } from "vitest";
setupMiniflareIsolatedStorage();

test("HTMLRewriter", async () => {
  const res = new HTMLRewriter()
    .on("p", {
      element(element) {
        element.setInnerContent("new");
      },
    })
    .transform(new Response("<p>old</p>"));
  expect(await res.text()).toBe("<p>new</p>");
});
