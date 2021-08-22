import a from "./a.mjs";
import b from "./b.mjs";

export default {
  fetch() {
    return new Response(a + b);
  },
};
